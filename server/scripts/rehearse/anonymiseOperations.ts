import type { DatabaseSync } from "node:sqlite";
import { quoteIdentifier, readColumnNames, hasTable } from "./sqliteIntrospection";
interface UpdateIfPresentInput {
  db: DatabaseSync;
  table: string;
  column: string;
  expression: string;
}
interface RemapIdsInput {
  db: DatabaseSync;
  table: string;
  idColumn: string;
  references: Reference[];
}
interface ScrubDanglingReferencesInput {
  db: DatabaseSync;
  parentTable: string;
  parentColumn: string;
  references: Reference[];
  label: string;
}
export function updateIfPresent({ db, table, column, expression }: UpdateIfPresentInput): void {
  if (!hasTable(db, table) || !readColumnNames(db, table).has(column)) return;
  db.exec(`UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column)} = ${expression}`);
}

interface Reference {
  table: string;
  column: string;
}

let remapSequence = 0;

/** Remap opaque ids as well as visible text. This preserves relationships while ensuring a
 * retained rehearsal directory cannot be joined back to ids from the source installation. */
export function remapIds({ db, table, idColumn, references }: RemapIdsInput): void {
  if (!hasTable(db, table) || !readColumnNames(db, table).has(idColumn)) return;
  const values = db
    .prepare(
      `SELECT DISTINCT ${quoteIdentifier(idColumn)} AS id FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(idColumn)}`,
    )
    .all() as Array<{ id: string | null }>;
  const existing = new Set(values.flatMap((row) => (row.id === null ? [] : [row.id])));
  const mappings: Array<{ source: string; replacement: string }> = [];
  for (const [index, row] of values.entries()) {
    if (row.id === null) continue;
    let replacement = `rehearsal-${table}-${index + 1}`;
    while (existing.has(replacement)) replacement = `${replacement}-x`;
    existing.add(replacement);
    mappings.push({ source: row.id, replacement });
  }
  if (mappings.length === 0) return;

  // One indexed temporary map plus one UPDATE per relationship keeps work proportional to the
  // represented rows. The former per-id child UPDATE rescanned large allocation tables N times.
  const mappingTable = quoteIdentifier(`capacitylens_rehearsal_id_map_${++remapSequence}`);
  db.exec(`CREATE TEMP TABLE ${mappingTable} (
    source TEXT PRIMARY KEY,
    replacement TEXT NOT NULL UNIQUE
  ) STRICT`);
  try {
    const insertMapping = db.prepare(`INSERT INTO ${mappingTable} (source, replacement) VALUES (?, ?)`);
    for (const mapping of mappings) insertMapping.run(mapping.source, mapping.replacement);

    const targets = [
      { table, column: idColumn },
      ...references.filter(
        (reference) => hasTable(db, reference.table) && readColumnNames(db, reference.table).has(reference.column),
      ),
    ];
    for (const target of targets) {
      const targetTable = quoteIdentifier(target.table);
      const targetColumn = quoteIdentifier(target.column);
      db.exec(`
        UPDATE ${targetTable}
           SET ${targetColumn} = (
             SELECT replacement FROM ${mappingTable} WHERE source = ${targetTable}.${targetColumn}
           )
         WHERE ${targetColumn} IN (SELECT source FROM ${mappingTable})
      `);
    }
  } finally {
    db.exec(`DROP TABLE ${mappingTable}`);
  }
}

/** App-owned control tables intentionally have no foreign keys, so corrupted or legacy rows can
 * reference a principal/workspace that has no parent row for remapIds() to discover. Scrub those
 * residual opaque identifiers too: a kept rehearsal snapshot must not retain source-installation
 * identifiers merely because the live database could no longer resolve them. */
export function scrubDanglingReferences({
  db,
  parentTable,
  parentColumn,
  references,
  label,
}: ScrubDanglingReferencesInput): void {
  for (const reference of references) {
    if (!hasTable(db, reference.table) || !readColumnNames(db, reference.table).has(reference.column)) continue;
    const table = quoteIdentifier(reference.table);
    const column = quoteIdentifier(reference.column);
    const replacement = `'rehearsal-dangling-${label}-' || rowid`;
    if (!hasTable(db, parentTable) || !readColumnNames(db, parentTable).has(parentColumn)) {
      db.exec(`UPDATE ${table} SET ${column} = ${replacement} WHERE ${column} IS NOT NULL`);
      continue;
    }
    db.exec(
      `UPDATE ${table} AS child
          SET ${column} = ${replacement}
        WHERE ${column} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${quoteIdentifier(parentTable)} AS parent
             WHERE parent.${quoteIdentifier(parentColumn)} = child.${column}
          )`,
    );
  }
}

interface RemapIdentityCoordinatesInput {
  db: DatabaseSync;
  hasProviderCoordinates: boolean;
}
function remapAccountCoordinates(db: DatabaseSync): void {
  remapIds({
    db: db,
    table: "accounts",
    idColumn: "id",
    references: [
      { table: "clients", column: "accountId" },
      { table: "disciplines", column: "accountId" },
      { table: "projects", column: "accountId" },
      { table: "phases", column: "accountId" },
      { table: "resources", column: "accountId" },
      { table: "activities", column: "accountId" },
      { table: "tasks", column: "accountId" },
      { table: "allocations", column: "accountId" },
      { table: "timeOff", column: "accountId" },
      { table: "closures", column: "accountId" },
      { table: "account_members", column: "accountId" },
      { table: "account_member_sign_in_tracking", column: "accountId" },
      { table: "account_ownership_transfers", column: "accountId" },
      { table: "invites", column: "accountId" },
      { table: "account_commands", column: "workspaceId" },
      { table: "capacitylens_sync_row_provenance", column: "accountId" },
    ],
  });
  remapIds({ db: db, table: "clients", idColumn: "id", references: [{ table: "projects", column: "clientId" }] });
  remapIds({
    db: db,
    table: "disciplines",
    idColumn: "id",
    references: [{ table: "resources", column: "disciplineId" }],
  });
}

function remapSchedulingCoordinates(db: DatabaseSync): void {
  remapIds({
    db: db,
    table: "projects",
    idColumn: "id",
    references: [
      { table: "phases", column: "projectId" },
      { table: "resources", column: "projectId" },
      { table: "activities", column: "projectId" },
      { table: "tasks", column: "projectId" },
      { table: "allocations", column: "projectId" },
    ],
  });
  remapIds({
    db: db,
    table: "phases",
    idColumn: "id",
    references: [
      { table: "activities", column: "phaseId" },
      { table: "tasks", column: "phaseId" },
    ],
  });
  remapIds({
    db: db,
    table: "resources",
    idColumn: "id",
    references: [
      { table: "allocations", column: "resourceId" },
      { table: "timeOff", column: "resourceId" },
    ],
  });
  remapIds({
    db: db,
    table: hasTable(db, "activities") ? "activities" : "tasks",
    idColumn: "id",
    references: [
      {
        table: "allocations",
        column: hasTable(db, "activities") ? "activityId" : "taskId",
      },
    ],
  });
  remapIds({ db: db, table: "allocations", idColumn: "id", references: [] });
  remapIds({ db: db, table: "timeOff", idColumn: "id", references: [] });
  remapIds({ db: db, table: "closures", idColumn: "id", references: [] });
}

function remapPrincipalCoordinates(db: DatabaseSync): void {
  remapIds({
    db: db,
    table: "user",
    idColumn: "id",
    references: [
      { table: "account", column: "userId" },
      { table: "session", column: "userId" },
      { table: "twoFactor", column: "userId" },
      { table: "account_members", column: "userId" },
      { table: "account_ownership_transfers", column: "initiatorUserId" },
      { table: "account_ownership_transfers", column: "targetUserId" },
      { table: "account_security_revisions", column: "principalId" },
      { table: "account_commands", column: "actorPrincipalId" },
      { table: "account_commands", column: "targetPrincipalId" },
      { table: "account_session_assurance", column: "principalId" },
      { table: "capacitylens_federated_link_ceremonies", column: "principalId" },
      { table: "capacitylens_federated_link_observations", column: "principalId" },
      // Better Auth password-reset ceremonies join through value = user.id. Preserve that
      // relationship under the rehearsal-safe id so migrations v12/v14 exercise their deletes.
      { table: "verification", column: "value" },
    ],
  });
  remapIds({
    db: db,
    table: "account",
    idColumn: "id",
    references: [{ table: "capacitylens_federated_link_observations", column: "accountRowId" }],
  });
  remapIds({ db: db, table: "capacitylens_federated_link_ceremonies", idColumn: "id", references: [] });
  scrubDanglingReferences({
    db: db,
    parentTable: "account",
    parentColumn: "id",
    references: [{ table: "capacitylens_federated_link_observations", column: "accountRowId" }],
    label: "provider-account",
  });
  // Assurance keys are application-scoped hashes of bearer session tokens, not Better Auth row
  // ids, so anonymise the two namespaces independently.
  remapIds({ db: db, table: "session", idColumn: "id", references: [] });
  remapIds({ db: db, table: "twoFactor", idColumn: "id", references: [] });
  remapIds({ db: db, table: "verification", idColumn: "id", references: [] });
  remapIds({ db: db, table: "invites", idColumn: "id", references: [] });
  remapIds({ db: db, table: "account_ownership_transfers", idColumn: "id", references: [] });
  remapIds({ db: db, table: "account_commands", idColumn: "commandId", references: [] });
  remapIds({ db: db, table: "account_session_assurance", idColumn: "sessionId", references: [] });
  remapIds({
    db: db,
    table: "account_federated_provider_bindings",
    idColumn: "providerId",
    references: [
      { table: "account", column: "providerId" },
      { table: "account_session_assurance", column: "providerId" },
      { table: "capacitylens_federated_link_ceremonies", column: "providerId" },
      { table: "capacitylens_federated_link_observations", column: "providerId" },
    ],
  });
}

function scrubIdentityCoordinates(db: DatabaseSync): void {
  scrubDanglingReferences({
    db: db,
    parentTable: "accounts",
    parentColumn: "id",
    references: [
      { table: "account_members", column: "accountId" },
      { table: "account_member_sign_in_tracking", column: "accountId" },
      { table: "account_ownership_transfers", column: "accountId" },
      { table: "invites", column: "accountId" },
      { table: "account_commands", column: "workspaceId" },
    ],
    label: "workspace",
  });
  scrubDanglingReferences({
    db: db,
    parentTable: "user",
    parentColumn: "id",
    references: [
      { table: "account", column: "userId" },
      { table: "account_members", column: "userId" },
      { table: "account_security_revisions", column: "principalId" },
      { table: "account_commands", column: "actorPrincipalId" },
      { table: "account_commands", column: "targetPrincipalId" },
      { table: "account_session_assurance", column: "principalId" },
      { table: "capacitylens_federated_link_ceremonies", column: "principalId" },
      { table: "capacitylens_federated_link_observations", column: "principalId" },
      // Other Better Auth ceremony values need not be user ids. Values that did not remap above
      // are still source identifiers, so replace only those dangling/non-user values safely.
      { table: "verification", column: "value" },
    ],
    label: "principal",
  });
  // Deliberately two calls with DISTINCT labels rather than two entries in the group above: the
  // dangling replacement is `<label>-<rowid>`, so one label would give both participants of the
  // same row the identical id and violate the table's "initiator is not the target" CHECK.
  scrubDanglingReferences({
    db: db,
    parentTable: "user",
    parentColumn: "id",
    references: [{ table: "account_ownership_transfers", column: "initiatorUserId" }],
    label: "transfer-initiator",
  });
  scrubDanglingReferences({
    db: db,
    parentTable: "user",
    parentColumn: "id",
    references: [{ table: "account_ownership_transfers", column: "targetUserId" }],
    label: "transfer-target",
  });
  // Credential rows and stale/legacy federated rows do not necessarily have a corresponding
  // application binding. Their providerId still identifies the source installation, so scrub
  // every value that the binding remap above could not resolve.
  scrubDanglingReferences({
    db: db,
    parentTable: "account_federated_provider_bindings",
    parentColumn: "providerId",
    references: [
      { table: "account", column: "providerId" },
      { table: "account_session_assurance", column: "providerId" },
      { table: "capacitylens_federated_link_ceremonies", column: "providerId" },
      { table: "capacitylens_federated_link_observations", column: "providerId" },
    ],
    label: "provider",
  });
}

export function remapIdentityCoordinates({ db, hasProviderCoordinates }: RemapIdentityCoordinatesInput): void {
  // Preserve the original admission proof before remapping any identity coordinates.
  // A stale subject, principal or provider must never become a valid proof after scrubbing.
  updateIfPresent({
    db,
    table: "capacitylens_federated_link_observations",
    column: "subject",
    expression: hasProviderCoordinates
      ? `COALESCE((SELECT 'rehearsal-provider-account-' || account.rowid FROM account
              WHERE account.id = capacitylens_federated_link_observations.accountRowId
                AND account.accountId = capacitylens_federated_link_observations.subject
                AND account.userId = capacitylens_federated_link_observations.principalId
                AND account.providerId = capacitylens_federated_link_observations.providerId),
              'rehearsal-orphan-subject-' || rowid)`
      : `'rehearsal-orphan-subject-' || rowid`,
  });
  remapAccountCoordinates(db);
  remapSchedulingCoordinates(db);
  remapPrincipalCoordinates(db);
  scrubIdentityCoordinates(db);
}
