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
    { table: "resources", column: "avatarUrl", expression: "NULL" },
    { table: activityTable, column: "name", expression: `'Rehearsal Activity ' || rowid` },
    { table: "allocations", column: "note", expression: "NULL" },
    { table: "allocations", column: "task", expression: "NULL" },
    { table: "timeOff", column: "note", expression: "NULL" },
    { table: "closures", column: "name", expression: `'Rehearsal Closure ' || rowid` },
  ]);
}

function anonymiseOperationalData(db: DatabaseSync): void {
  // Proof intents are short-lived operational secrets and have no rehearsal value.
  if (hasTable(db, "microsoft_identity_proofs")) db.exec("DELETE FROM microsoft_identity_proofs");
  if (hasTable(db, "company_join_intents")) db.exec("DELETE FROM company_join_intents");
  // `applicationId` names one logical value ("capacitylens") shared across this table,
  // account_commands and capacitylens_sso_cutover_state, but each is remapped into its own
  // per-table rehearsal namespace independently. Deliberate: nothing joins across these tables on
  // applicationId today. If that ever changes, this per-table remap would need to become shared.
  remapIds({
    db,
    table: "account_federated_provider_bindings",
    idColumn: "applicationId",
    references: [],
  });
  remapIds({ db, table: "account_commands", idColumn: "applicationId", references: [] });
  applyRedactions(db, [
    { table: "capacitylens_audit_outbox", column: "id", expression: `'rehearsal-audit-' || rowid` },
    { table: "capacitylens_audit_outbox", column: "payload", expression: `'{}'` },
    { table: "capacitylens_sync_row_provenance", column: "rowId", expression: `'rehearsal-sync-row-' || rowid` },
    { table: "capacitylens_sync_row_provenance", column: "rowHash", expression: `lower(hex(zeroblob(32)))` },
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

function uniqueUserAliasFor(addressAliases: ReadonlyMap<string, string>): (value: string) => string | null {
  const usedVariants = new Map<string, number>();
  return (value) => {
    const normalized = value.trim().toLowerCase();
    const base = addressAliases.get(normalized);
    if (!base) return null;
    let variant = usedVariants.get(normalized) ?? 0;
    usedVariants.set(normalized, variant + 1);
    const result = [...base]
      .map((character) => {
        if (!/[a-z]/.test(character)) return character;
        const upper = variant % 2 === 1;
        variant = Math.floor(variant / 2);
        return upper ? character.toUpperCase() : character;
      })
      .join("");
    if (variant !== 0) throw new Error("Too many equivalent rehearsal email addresses.");
    return result;
  };
}

// One pass must share aliases across retained restrictions, recreated identities, and proof rows.
// eslint-disable-next-line complexity
function anonymiseProofAddresses(db: DatabaseSync): void {
  const restrictions = hasTable(db, "account_access_restrictions")
    ? (db
        .prepare(
          `SELECT rowid AS rowId, verifiedEmail FROM account_access_restrictions
        WHERE verifiedEmail IS NOT NULL ORDER BY rowid`,
        )
        .all() as Array<{ rowId: number; verifiedEmail: string }>)
    : [];
  const proofs = hasTable(db, "identity_email_proofs")
    ? (db.prepare(`SELECT rowid AS rowId, email FROM identity_email_proofs ORDER BY rowid`).all() as Array<{
        rowId: number;
        email: string;
      }>)
    : [];
  const addressAliases = new Map<string, string>();
  for (const [index, value] of [
    ...restrictions.map((row) => row.verifiedEmail),
    ...proofs.map((row) => row.email),
  ].entries()) {
    const normalized = value.trim().toLowerCase();
    if (!addressAliases.has(normalized)) {
      addressAliases.set(normalized, `rehearsal-proof-${index + 1}@example.invalid`);
    }
  }
  const alias = (value: string): string => {
    const mapped = addressAliases.get(value.trim().toLowerCase());
    if (!mapped) throw new Error("Missing rehearsal email alias.");
    return mapped;
  };
  const uniqueUserAlias = uniqueUserAliasFor(addressAliases);
  if (hasTable(db, "user") && readColumnNames(db, "user").has("email")) {
    const users = db.prepare("SELECT rowid AS rowId, email FROM user").all() as Array<{ rowId: number; email: string }>;
    const updateUser = db.prepare("UPDATE user SET email = ? WHERE rowid = ?");
    for (const user of users) {
      const address = uniqueUserAlias(user.email);
      updateUser.run(address ?? `rehearsal-user-${user.rowId}@example.invalid`, user.rowId);
    }
  }
  if (restrictions.length > 0) {
    const updateRestriction = db.prepare("UPDATE account_access_restrictions SET verifiedEmail = ? WHERE rowid = ?");
    for (const restriction of restrictions) {
      updateRestriction.run(alias(restriction.verifiedEmail), restriction.rowId);
    }
  }
  if (proofs.length > 0) {
    const updateProof = db.prepare("UPDATE identity_email_proofs SET email = ? WHERE rowid = ?");
    for (const proof of proofs) updateProof.run(alias(proof.email), proof.rowId);
  }
}

function anonymiseIdentityData(db: DatabaseSync, hasProviderCoordinates: boolean): void {
  // Build one alias per original proven address before redacting either side. A recreated
  // principal may hold the restricted address while the original principal has since changed it.
  anonymiseProofAddresses(db);
  const secrets = ["accessToken", "refreshToken", "idToken", "password"].map((column) => ({
    table: "account",
    column,
    expression: "NULL",
  }));
  applyRedactions(db, [
    { table: "user", column: "name", expression: `'Rehearsal User ' || rowid` },
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
