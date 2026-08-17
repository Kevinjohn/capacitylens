import type { Db } from "./db";

export interface TenantRelationship {
  childTable: string;
  parentColumn: string;
  parentTable: string;
}

/** Every product relationship whose child and parent must carry the same accountId. Shared with
 *  erasure.ts, which builds its account-scoped edge check from this same canonical list. */
export const TENANT_RELATIONSHIPS: readonly TenantRelationship[] = [
  { childTable: "resources", parentColumn: "disciplineId", parentTable: "disciplines" },
  { childTable: "projects", parentColumn: "clientId", parentTable: "clients" },
  { childTable: "phases", parentColumn: "projectId", parentTable: "projects" },
  { childTable: "resources", parentColumn: "projectId", parentTable: "projects" },
  { childTable: "activities", parentColumn: "projectId", parentTable: "projects" },
  { childTable: "activities", parentColumn: "phaseId", parentTable: "phases" },
  { childTable: "allocations", parentColumn: "resourceId", parentTable: "resources" },
  { childTable: "allocations", parentColumn: "activityId", parentTable: "activities" },
  { childTable: "timeOff", parentColumn: "resourceId", parentTable: "resources" },
];

const SCOPED_TABLES = [
  "clients",
  "disciplines",
  "projects",
  "phases",
  "resources",
  "activities",
  "allocations",
  "timeOff",
] as const;

const relationshipTriggerName = (relationship: TenantRelationship, operation: "insert" | "update"): string =>
  `capacitylens_tenant_${relationship.childTable}_${relationship.parentColumn}_${operation}`;

const accountTriggerName = (table: string): string => `capacitylens_tenant_${table}_account_immutable`;

const relationshipTriggerSql = (relationship: TenantRelationship, operation: "insert" | "update"): string => {
  const name = relationshipTriggerName(relationship, operation);
  const event =
    operation === "insert"
      ? `INSERT ON ${relationship.childTable}`
      : `UPDATE OF accountId, ${relationship.parentColumn} ON ${relationship.childTable}`;
  const label = `${relationship.childTable}.${relationship.parentColumn} -> ${relationship.parentTable}.id`;
  return `CREATE TRIGGER ${name}
BEFORE ${event}
WHEN NEW.${relationship.parentColumn} IS NOT NULL AND EXISTS (
  SELECT 1 FROM ${relationship.parentTable} AS parent
   WHERE parent.id = NEW.${relationship.parentColumn}
     AND parent.accountId <> NEW.accountId
)
BEGIN
  SELECT RAISE(ABORT, 'cross-account relationship: ${label}');
END;`;
};

const accountTriggerSql = (table: string): string => `CREATE TRIGGER ${accountTriggerName(table)}
BEFORE UPDATE OF accountId ON ${table}
WHEN NEW.accountId <> OLD.accountId
BEGIN
  SELECT RAISE(ABORT, 'accountId is immutable: ${table}');
END;`;

const TRIGGER_DEFINITIONS_V19 = [
  ...TENANT_RELATIONSHIPS.flatMap((relationship) => [
    { name: relationshipTriggerName(relationship, "insert"), sql: relationshipTriggerSql(relationship, "insert") },
    { name: relationshipTriggerName(relationship, "update"), sql: relationshipTriggerSql(relationship, "update") },
  ]),
  ...SCOPED_TABLES.map((table) => ({ name: accountTriggerName(table), sql: accountTriggerSql(table) })),
] as const;

/** Frozen into database migration v19. Add future relationship guards in a new migration. */
export const TENANT_RELATIONSHIP_INTEGRITY_V19_SQL = TRIGGER_DEFINITIONS_V19.map(
  ({ name, sql }) => `DROP TRIGGER IF EXISTS ${name};\n${sql}`,
).join("\n");

const CLOSURE_ACCOUNT_TRIGGER = {
  name: accountTriggerName("closures"),
  sql: accountTriggerSql("closures"),
} as const;

/** Tenant guard installed with the first-class closure table in v34. */
export const CLOSURE_TENANT_INTEGRITY_V34_SQL = `DROP TRIGGER IF EXISTS ${CLOSURE_ACCOUNT_TRIGGER.name};\n${CLOSURE_ACCOUNT_TRIGGER.sql}`;

const CURRENT_TRIGGER_DEFINITIONS = [...TRIGGER_DEFINITIONS_V19, CLOSURE_ACCOUNT_TRIGGER] as const;

interface CrossTenantEdge {
  relationship: string;
  parentId: string;
  childId: string;
  childAccountId: string;
  parentAccountId: string;
}

const crossTenantEdgeSql =
  TENANT_RELATIONSHIPS.map(
    (relationship) => `
  SELECT '${relationship.childTable}.${relationship.parentColumn} -> ${relationship.parentTable}.id' AS relationship,
         parent.id AS parentId, child.id AS childId,
         child.accountId AS childAccountId, parent.accountId AS parentAccountId
    FROM ${relationship.parentTable} AS parent
    JOIN ${relationship.childTable} AS child ON child.${relationship.parentColumn} = parent.id
   WHERE child.accountId <> parent.accountId`,
  ).join("\n  UNION ALL") + "\n  LIMIT 1";

/** Reject a database whose individually valid foreign keys form a cross-account relationship. */
export function assertNoCrossTenantRelationships(db: Db): void {
  const edge = db.prepare(crossTenantEdgeSql).get() as CrossTenantEdge | undefined;
  if (!edge) return;
  throw new Error(
    `Database tenant integrity check failed: ${edge.relationship} has parent account ` +
      `"${edge.parentAccountId}" and child account "${edge.childAccountId}" ` +
      `(parent "${edge.parentId}", child "${edge.childId}").`,
  );
}

function assertTenantRelationshipIntegrity(
  db: Db,
  definitions: typeof CURRENT_TRIGGER_DEFINITIONS,
  allowCompatibleExtensions = false,
): void {
  assertNoCrossTenantRelationships(db);
  const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").trim().replace(/;$/, "");
  const expected = new Map(definitions.map(({ name, sql }) => [name, normalizeSql(sql)]));
  const actual = (
    db
      .prepare(
        `
    SELECT name, sql FROM sqlite_master
     WHERE type = 'trigger' AND name LIKE 'capacitylens_tenant_%'
     ORDER BY name
  `,
      )
      .all() as Array<{ name: string; sql: string }>
  ).map((row) => ({
    name: row.name,
    sql: normalizeSql(row.sql),
  }));
  const invalid = actual.find((trigger) => expected.has(trigger.name) && expected.get(trigger.name) !== trigger.sql);
  const missing = [...expected.keys()].find((name) => !actual.some((trigger) => trigger.name === name));
  if ((!allowCompatibleExtensions && actual.length !== expected.size) || missing || invalid) {
    throw new Error(
      `Database tenant-integrity trigger set is invalid (expected ${expected.size}, found ${actual.length}` +
        `${invalid ? `; first mismatch ${invalid.name}` : missing ? `; missing ${missing}` : ""}).`,
    );
  }
}

/** Verify the released v19 trigger set while replaying migrations before v34. */
export function assertTenantRelationshipIntegrityV19(db: Db): void {
  assertTenantRelationshipIntegrity(db, TRIGGER_DEFINITIONS_V19 as unknown as typeof CURRENT_TRIGGER_DEFINITIONS, true);
}

/** Verify both live data and the complete current trigger set on every database open. */
export function assertTenantRelationshipIntegrityCurrent(db: Db): void {
  assertTenantRelationshipIntegrity(db, CURRENT_TRIGGER_DEFINITIONS);
}
