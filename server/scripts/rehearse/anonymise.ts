import type { DatabaseSync } from "node:sqlite";
import { tx } from "../../src/txn";
import { updateIfPresent, remapIds, remapIdentityCoordinates } from "./anonymiseOperations";
import { KNOWN_COLUMNS, KNOWN_TABLES } from "./knownColumns";
import { quoteIdentifier, listTableNames, readColumnNames, hasTable } from "./sqliteIntrospection";

interface Redaction {
  table: string;
  column: string;
  expression: string;
}

function applyRedactions(db: DatabaseSync, redactions: readonly Redaction[]): void {
  for (const redaction of redactions) updateIfPresent({ db, ...redaction });
}

function assertAnonymisationCoverage(db: DatabaseSync): void {
  const tables = listTableNames(db);
  const unknownTables = tables.filter((table) => !KNOWN_TABLES.has(table));
  if (unknownTables.length > 0) throw new Error(`anonymiser does not cover table(s): ${unknownTables.join(", ")}`);
  const unknownColumns = tables.flatMap((table) =>
    [...readColumnNames(db, table)]
      .filter((column) => !KNOWN_COLUMNS[table]?.has(column))
      .map((column) => `${table}.${column}`),
  );
  if (unknownColumns.length > 0) throw new Error(`anonymiser does not cover column(s): ${unknownColumns.join(", ")}`);
}

function anonymiseSchedulingData(db: DatabaseSync): void {
  const activityTable = hasTable(db, "activities") ? "activities" : "tasks";
  const clientName = readColumnNames(db, "clients").has("builtin")
    ? `CASE WHEN builtin = 'true' THEN 'Internal' ELSE 'Rehearsal Client ' || rowid END`
    : `'Rehearsal Client ' || rowid`;
  applyRedactions(db, [
    { table: "accounts", column: "name", expression: `'Rehearsal Account ' || rowid` },
    { table: "clients", column: "name", expression: clientName },
    {
      table: "clients",
      column: "codeName",
      expression: `CASE WHEN codeName IS NULL THEN NULL ELSE 'Client ' || rowid END`,
    },
    { table: "disciplines", column: "name", expression: `'Rehearsal Discipline ' || rowid` },
    { table: "projects", column: "name", expression: `'Rehearsal Project ' || rowid` },
    {
      table: "projects",
      column: "codeName",
      expression: `CASE WHEN codeName IS NULL THEN NULL ELSE 'Project ' || rowid END`,
    },
    { table: "phases", column: "name", expression: `'Rehearsal Phase ' || rowid` },
    {
      table: "resources",
      column: "name",
      expression: `CASE WHEN name IS NULL THEN NULL ELSE 'Rehearsal Resource ' || rowid END`,
    },
    { table: "resources", column: "role", expression: `'Rehearsal Role ' || rowid` },
    { table: activityTable, column: "name", expression: `'Rehearsal Activity ' || rowid` },
    { table: "allocations", column: "note", expression: "NULL" },
    { table: "allocations", column: "task", expression: "NULL" },
    { table: "timeOff", column: "note", expression: "NULL" },
    { table: "closures", column: "name", expression: `'Rehearsal Closure ' || rowid` },
  ]);
}

function anonymiseOperationalData(db: DatabaseSync): void {
  remapIds({
    db,
    table: "account_federated_provider_bindings",
    idColumn: "applicationId",
    references: [],
  });
  applyRedactions(db, [
    { table: "capacitylens_audit_outbox", column: "id", expression: `'rehearsal-audit-' || rowid` },
    { table: "capacitylens_audit_outbox", column: "payload", expression: `'{}'` },
    { table: "capacitylens_sync_row_provenance", column: "rowId", expression: `'rehearsal-sync-row-' || rowid` },
    { table: "capacitylens_sync_row_provenance", column: "rowHash", expression: `lower(hex(zeroblob(32)))` },
    { table: "account_commands", column: "applicationId", expression: `'rehearsal-app'` },
    { table: "account_commands", column: "operation", expression: `'rehearsal-operation-' || rowid` },
    { table: "account_commands", column: "idempotencyKey", expression: `'rehearsal-key-' || rowid` },
    { table: "account_commands", column: "payloadHash", expression: `lower(hex(zeroblob(32)))` },
    {
      table: "account_commands",
      column: "resultJson",
      expression: `CASE WHEN status = 'pending' THEN NULL WHEN status = 'completed' THEN '{}' WHEN resultJson IS NULL THEN NULL ELSE '{"kind":"rehearsal-redacted"}' END`,
    },
    {
      table: "account_federated_provider_bindings",
      column: "issuer",
      expression: `'https://idp-' || rowid || '.example.invalid'`,
    },
  ]);
  remapIds({
    db,
    table: "capacitylens_sync_sessions",
    idColumn: "sessionId",
    references: [{ table: "capacitylens_sync_row_provenance", column: "sessionId" }],
  });
  remapIds({ db, table: "capacitylens_sso_cutover_state", idColumn: "applicationId", references: [] });
}

function updateFederatedObservations(db: DatabaseSync, hasProviderCoordinates: boolean): void {
  if (!hasProviderCoordinates || !hasTable(db, "capacitylens_federated_link_observations")) return;
  db.exec(`UPDATE capacitylens_federated_link_observations AS observation
    SET (principalId, providerId) = (
      SELECT account.userId, account.providerId FROM account WHERE account.id = observation.accountRowId
    ) WHERE EXISTS (
      SELECT 1 FROM account WHERE account.id = observation.accountRowId AND account.accountId = observation.subject
    )`);
}

function anonymiseIdentityData(db: DatabaseSync, hasProviderCoordinates: boolean): void {
  const secrets = ["accessToken", "refreshToken", "idToken", "password"].map((column) => ({
    table: "account",
    column,
    expression: "NULL",
  }));
  applyRedactions(db, [
    { table: "user", column: "name", expression: `'Rehearsal User ' || rowid` },
    { table: "user", column: "email", expression: `'rehearsal-user-' || rowid || '@example.invalid'` },
    { table: "user", column: "image", expression: "NULL" },
    { table: "account", column: "accountId", expression: `'rehearsal-provider-account-' || rowid` },
    ...secrets,
    { table: "session", column: "token", expression: `'rehearsal-session-' || rowid` },
    { table: "session", column: "ipAddress", expression: "NULL" },
    { table: "session", column: "userAgent", expression: `'Rehearsal'` },
    { table: "twoFactor", column: "secret", expression: `'rehearsal-disabled-' || rowid` },
    { table: "twoFactor", column: "backupCodes", expression: `'[]'` },
    { table: "verification", column: "identifier", expression: `'rehearsal-verification-' || rowid` },
    { table: "invites", column: "token", expression: `'rehearsal-invite-' || rowid` },
    { table: "invites", column: "tokenHash", expression: `'rehearsal-invite-hash-' || rowid` },
    {
      table: "invites",
      column: "preauthEmail",
      expression: `CASE WHEN preauthEmail IS NULL THEN NULL ELSE 'invite-' || rowid || '@example.invalid' END`,
    },
    { table: "capacitylens_bootstrap_claim", column: "claimToken", expression: `'rehearsal-disabled'` },
  ]);
  updateFederatedObservations(db, hasProviderCoordinates);
}

function anonymiseTransaction(db: DatabaseSync): void {
  const triggers = db
    .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY rowid")
    .all() as Array<{ name: string; sql: string }>;
  for (const trigger of triggers) db.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`);
  const hasProviderCoordinates =
    hasTable(db, "account") &&
    ["id", "accountId", "userId", "providerId"].every((column) => readColumnNames(db, "account").has(column));
  remapIdentityCoordinates({ db, hasProviderCoordinates });
  anonymiseSchedulingData(db);
  anonymiseOperationalData(db);
  anonymiseIdentityData(db, hasProviderCoordinates);
  for (const trigger of triggers) db.exec(trigger.sql);
}

/** Sanitise only a temporary online snapshot. Unknown tables fail closed so a new auth/plugin table
 * cannot carry secrets into a kept rehearsal directory until the redaction policy covers it. */
export function anonymise(db: DatabaseSync): void {
  assertAnonymisationCoverage(db);
  db.exec("PRAGMA foreign_keys = OFF; PRAGMA secure_delete = ON;");
  tx(db, () => anonymiseTransaction(db), "immediate");
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) throw new Error(`anonymised copy has ${violations.length} foreign-key violation(s)`);
  // secure_delete overwrites replaced values while preserving the copied database's physical shape.
}
