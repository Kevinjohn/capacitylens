import type { Db } from "../../db";

/** Frozen migration body for DB schema v15. Never amend after v15 ships. */
export const ACCOUNT_BOUNDARY_STATE_V15_SQL = `
CREATE TABLE IF NOT EXISTS account_security_revisions (
  principalId TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  updatedAt TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS account_commands (
  applicationId TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL,
  commandId TEXT NOT NULL UNIQUE,
  actorPrincipalId TEXT,
  targetPrincipalId TEXT,
  workspaceId TEXT,
  payloadHash TEXT NOT NULL CHECK(length(payloadHash) = 64),
  status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'compensated', 'reconciliation_required')),
  resultJson TEXT CHECK(resultJson IS NULL OR json_valid(resultJson)),
  failureCode TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK(
    (status = 'pending' AND resultJson IS NULL AND failureCode IS NULL) OR
    (status = 'completed' AND resultJson IS NOT NULL AND failureCode IS NULL) OR
    (status IN ('compensated', 'reconciliation_required') AND failureCode IS NOT NULL)
  ),
  PRIMARY KEY (applicationId, operation, idempotencyKey)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_account_commands_status ON account_commands(status);
CREATE INDEX IF NOT EXISTS idx_account_commands_updatedAt ON account_commands(updatedAt);
CREATE INDEX IF NOT EXISTS idx_account_commands_workspaceId ON account_commands(workspaceId);

CREATE TABLE IF NOT EXISTS account_session_assurance (
  sessionId TEXT NOT NULL PRIMARY KEY,
  principalId TEXT NOT NULL,
  assurance TEXT NOT NULL CHECK(assurance IN ('password', 'mfa', 'federated')),
  providerId TEXT,
  createdAt TEXT NOT NULL,
  CHECK(
    (assurance = 'federated' AND providerId IS NOT NULL) OR
    (assurance IN ('password', 'mfa') AND providerId IS NULL)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_account_session_assurance_principalId
  ON account_session_assurance(principalId);

CREATE TABLE IF NOT EXISTS account_federated_provider_bindings (
  applicationId TEXT NOT NULL,
  issuer TEXT NOT NULL,
  providerId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (applicationId, issuer),
  UNIQUE (applicationId, providerId)
) STRICT;
`;

const CURRENT_ACCOUNT_BOUNDARY_STATE_SQL = ACCOUNT_BOUNDARY_STATE_V15_SQL;

export function ensureAccountBoundaryState(db: Db): void {
  db.exec(CURRENT_ACCOUNT_BOUNDARY_STATE_SQL);
}

/** Normalized (whitespace-collapsed, lowercased) `CREATE TABLE` SQL for `table`, or `""` if the
 * table doesn't exist. Shared by {@link assertAccountBoundaryStateCurrent} and
 * memberSignInTracking.ts's schema assertion, which derived this identically before extraction. Do
 * NOT converge with schema.ts's normalizeSchemaObjectSql — that helper has different semantics
 * (case-preserving, strips IF NOT EXISTS/`;`). */
export function normalizedTableCreateSql(db: Db, table: string): string {
  return String(
    (
      db.prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?`).get(table) as
        { sql?: string } | undefined
    )?.sql ?? "",
  )
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function assertAccountBoundaryStateCurrent(db: Db): void {
  const expected: Record<string, Record<string, { type: string; required: boolean; pk: number }>> = {
    account_security_revisions: {
      principalId: { type: "TEXT", required: true, pk: 1 },
      revision: { type: "INTEGER", required: true, pk: 0 },
      updatedAt: { type: "TEXT", required: true, pk: 0 },
    },
    account_commands: {
      applicationId: { type: "TEXT", required: true, pk: 1 },
      operation: { type: "TEXT", required: true, pk: 2 },
      idempotencyKey: { type: "TEXT", required: true, pk: 3 },
      commandId: { type: "TEXT", required: true, pk: 0 },
      actorPrincipalId: { type: "TEXT", required: false, pk: 0 },
      targetPrincipalId: { type: "TEXT", required: false, pk: 0 },
      workspaceId: { type: "TEXT", required: false, pk: 0 },
      payloadHash: { type: "TEXT", required: true, pk: 0 },
      status: { type: "TEXT", required: true, pk: 0 },
      resultJson: { type: "TEXT", required: false, pk: 0 },
      failureCode: { type: "TEXT", required: false, pk: 0 },
      createdAt: { type: "TEXT", required: true, pk: 0 },
      updatedAt: { type: "TEXT", required: true, pk: 0 },
    },
    account_session_assurance: {
      sessionId: { type: "TEXT", required: true, pk: 1 },
      principalId: { type: "TEXT", required: true, pk: 0 },
      assurance: { type: "TEXT", required: true, pk: 0 },
      providerId: { type: "TEXT", required: false, pk: 0 },
      createdAt: { type: "TEXT", required: true, pk: 0 },
    },
    account_federated_provider_bindings: {
      applicationId: { type: "TEXT", required: true, pk: 1 },
      issuer: { type: "TEXT", required: true, pk: 2 },
      providerId: { type: "TEXT", required: true, pk: 0 },
      createdAt: { type: "TEXT", required: true, pk: 0 },
    },
  };
  const problems: string[] = [];
  for (const [table, columns] of Object.entries(expected)) {
    const liveColumns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    const live = new Map(liveColumns.map((column) => [column.name, column]));
    for (const [name, definition] of Object.entries(columns)) {
      if (!live.has(name)) problems.push(`missing ${table}.${name}`);
      else {
        const column = live.get(name)!;
        if (column.type.toUpperCase() !== definition.type) {
          problems.push(`${table}.${name} has type ${column.type} (expected ${definition.type})`);
        }
        if ((column.notnull === 1) !== definition.required) {
          problems.push(
            `${table}.${name} is ${column.notnull === 1 ? "NOT NULL" : "nullable"} ` +
              `(expected ${definition.required ? "NOT NULL" : "nullable"})`,
          );
        }
        if (column.pk !== definition.pk) {
          problems.push(`${table}.${name} has primary-key position ${column.pk} (expected ${definition.pk})`);
        }
      }
    }
    for (const column of liveColumns) {
      if (!(column.name in columns)) problems.push(`unexpected ${table}.${column.name}`);
    }
  }
  const requiredSql: Record<string, readonly string[]> = {
    account_security_revisions: ["principalid text not null primary key", "check(revision >= 0)", ") strict"],
    account_commands: [
      "commandid text not null unique",
      "primary key (applicationid, operation, idempotencykey)",
      "check(length(payloadhash) = 64)",
      "check(status in ('pending', 'completed', 'compensated', 'reconciliation_required'))",
      "check(resultjson is null or json_valid(resultjson))",
      "(status = 'completed' and resultjson is not null and failurecode is null)",
      ") strict",
    ],
    account_session_assurance: [
      "sessionid text not null primary key",
      "principalid text not null",
      "check(assurance in ('password', 'mfa', 'federated'))",
      "(assurance = 'federated' and providerid is not null)",
      "(assurance in ('password', 'mfa') and providerid is null)",
      ") strict",
    ],
    account_federated_provider_bindings: [
      "primary key (applicationid, issuer)",
      "unique (applicationid, providerid)",
      ") strict",
    ],
  };
  for (const [table, fragments] of Object.entries(requiredSql)) {
    const sql = normalizedTableCreateSql(db, table);
    for (const required of fragments) {
      if (!sql.includes(required)) problems.push(`${table} is missing constraint: ${required}`);
    }
  }
  const expectedIndexes = new Map<string, { table: string; column: string }>([
    ["idx_account_commands_status", { table: "account_commands", column: "status" }],
    ["idx_account_commands_updatedAt", { table: "account_commands", column: "updatedAt" }],
    ["idx_account_commands_workspaceId", { table: "account_commands", column: "workspaceId" }],
    [
      "idx_account_session_assurance_principalId",
      {
        table: "account_session_assurance",
        column: "principalId",
      },
    ],
  ]);
  for (const [name, { table, column }] of expectedIndexes) {
    const belongsToExpectedTable = (
      db.prepare(`PRAGMA index_list(${table})`).all() as Array<{
        name: string;
        unique: number;
      }>
    ).some((index) => index.name === name && index.unique === 0);
    const definition = db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name: string }>;
    if (!belongsToExpectedTable || definition.length !== 1 || definition[0]?.name !== column) {
      problems.push(`index ${name} does not cover exactly ${table}.${column}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`DB account-boundary schema mismatch: ${problems.join("; ")}.`);
  }
}
