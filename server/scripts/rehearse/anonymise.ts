import type { DatabaseSync } from "node:sqlite";
import { tx } from "../../src/txn";
import { updateIfPresent, remapIds, remapIdentityCoordinates } from "./anonymiseOperations";
import { KNOWN_COLUMNS, KNOWN_TABLES } from "./knownColumns";
import { quoteIdentifier, listTableNames, readColumnNames, hasTable } from "./sqliteIntrospection";

/** Sanitise only a temporary online snapshot. Unknown tables fail closed so a new auth/plugin table
 * cannot carry secrets into a kept rehearsal directory until the redaction policy covers it. */
export function anonymise(db: DatabaseSync): void {
  const unknown = listTableNames(db).filter((table) => !KNOWN_TABLES.has(table));
  if (unknown.length > 0) {
    throw new Error(`anonymiser does not cover table(s): ${unknown.join(", ")}`);
  }
  const unknownColumns = listTableNames(db).flatMap((table) =>
    [...readColumnNames(db, table)]
      .filter((column) => !KNOWN_COLUMNS[table]?.has(column))
      .map((column) => `${table}.${column}`),
  );
  if (unknownColumns.length > 0) {
    throw new Error(`anonymiser does not cover column(s): ${unknownColumns.join(", ")}`);
  }

  db.exec("PRAGMA foreign_keys = OFF; PRAGMA secure_delete = ON;");
  tx(
    db,
    () => {
      // Tenant guards reject identity remaps and sync triggers can record source identifiers.
      // Suspend them only on this temporary copy, restoring the exact definitions in the same
      // transaction so both success and rollback preserve the schema being rehearsed.
      const triggers = db
        .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY rowid")
        .all() as Array<{ name: string; sql: string }>;
      for (const trigger of triggers) db.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`);
      const hasProviderCoordinates =
        hasTable(db, "account") &&
        ["id", "accountId", "userId", "providerId"].every((column) => readColumnNames(db, "account").has(column));
      remapIdentityCoordinates({ db, hasProviderCoordinates });

      updateIfPresent({ db: db, table: "accounts", column: "name", expression: `'Rehearsal Account ' || rowid` });
      updateIfPresent({
        db: db,
        table: "clients",
        column: "name",
        expression: readColumnNames(db, "clients").has("builtin")
          ? `CASE WHEN builtin = 'true' THEN 'Internal' ELSE 'Rehearsal Client ' || rowid END`
          : `'Rehearsal Client ' || rowid`,
      });
      updateIfPresent({
        db: db,
        table: "clients",
        column: "codeName",
        expression: `CASE WHEN codeName IS NULL THEN NULL ELSE 'Client ' || rowid END`,
      });
      updateIfPresent({ db: db, table: "disciplines", column: "name", expression: `'Rehearsal Discipline ' || rowid` });
      updateIfPresent({ db: db, table: "projects", column: "name", expression: `'Rehearsal Project ' || rowid` });
      updateIfPresent({
        db: db,
        table: "projects",
        column: "codeName",
        expression: `CASE WHEN codeName IS NULL THEN NULL ELSE 'Project ' || rowid END`,
      });
      updateIfPresent({ db: db, table: "phases", column: "name", expression: `'Rehearsal Phase ' || rowid` });
      updateIfPresent({
        db: db,
        table: "resources",
        column: "name",
        expression: `CASE WHEN name IS NULL THEN NULL ELSE 'Rehearsal Resource ' || rowid END`,
      });
      updateIfPresent({ db: db, table: "resources", column: "role", expression: `'Rehearsal Role ' || rowid` });
      updateIfPresent({
        db: db,
        table: hasTable(db, "activities") ? "activities" : "tasks",
        column: "name",
        expression: `'Rehearsal Activity ' || rowid`,
      });
      updateIfPresent({ db: db, table: "allocations", column: "note", expression: "NULL" });
      updateIfPresent({ db: db, table: "timeOff", column: "note", expression: "NULL" });
      updateIfPresent({ db: db, table: "closures", column: "name", expression: `'Rehearsal Closure ' || rowid` });
      // Preserve scheduling flags, working days, half-days, engagement, series grouping and dates.
      updateIfPresent({
        db: db,
        table: "capacitylens_audit_outbox",
        column: "id",
        expression: `'rehearsal-audit-' || rowid`,
      });
      updateIfPresent({ db: db, table: "capacitylens_audit_outbox", column: "payload", expression: `'{}'` });
      remapIds({
        db: db,
        table: "capacitylens_sync_sessions",
        idColumn: "sessionId",
        references: [{ table: "capacitylens_sync_row_provenance", column: "sessionId" }],
      });
      updateIfPresent({
        db: db,
        table: "capacitylens_sync_row_provenance",
        column: "rowId",
        expression: `'rehearsal-sync-row-' || rowid`,
      });
      updateIfPresent({
        db: db,
        table: "capacitylens_sync_row_provenance",
        column: "rowHash",
        expression: `lower(hex(zeroblob(32)))`,
      });

      updateIfPresent({ db: db, table: "user", column: "name", expression: `'Rehearsal User ' || rowid` });
      updateIfPresent({
        db: db,
        table: "user",
        column: "email",
        expression: `'rehearsal-user-' || rowid || '@example.invalid'`,
      });
      updateIfPresent({ db: db, table: "user", column: "image", expression: "NULL" });
      updateIfPresent({
        db: db,
        table: "account",
        column: "accountId",
        expression: `'rehearsal-provider-account-' || rowid`,
      });
      if (hasProviderCoordinates && hasTable(db, "capacitylens_federated_link_observations")) {
        // Unbound providers/principals are scrubbed independently by row. Carry their final
        // coordinates to observations only when the complete original proof matched above.
        db.exec(`UPDATE capacitylens_federated_link_observations AS observation
          SET (principalId, providerId) = (
            SELECT account.userId, account.providerId FROM account WHERE account.id = observation.accountRowId
          )
          WHERE EXISTS (
            SELECT 1 FROM account
            WHERE account.id = observation.accountRowId AND account.accountId = observation.subject
          )`);
      }
      remapIds({ db: db, table: "capacitylens_sso_cutover_state", idColumn: "applicationId", references: [] });
      // Identity timestamps and completion/audit flags are retained; ceremony ids are disabled
      // by remapping and provider/principal coordinates are remapped or scrubbed above.
      for (const secret of ["accessToken", "refreshToken", "idToken", "password"]) {
        updateIfPresent({ db: db, table: "account", column: secret, expression: "NULL" });
      }
      updateIfPresent({ db: db, table: "session", column: "token", expression: `'rehearsal-session-' || rowid` });
      updateIfPresent({ db: db, table: "session", column: "ipAddress", expression: "NULL" });
      updateIfPresent({ db: db, table: "session", column: "userAgent", expression: `'Rehearsal'` });
      updateIfPresent({ db: db, table: "twoFactor", column: "secret", expression: `'rehearsal-disabled-' || rowid` });
      updateIfPresent({ db: db, table: "twoFactor", column: "backupCodes", expression: `'[]'` });
      updateIfPresent({
        db: db,
        table: "verification",
        column: "identifier",
        expression: `'rehearsal-verification-' || rowid`,
      });
      updateIfPresent({ db: db, table: "invites", column: "token", expression: `'rehearsal-invite-' || rowid` });
      updateIfPresent({
        db: db,
        table: "invites",
        column: "tokenHash",
        expression: `'rehearsal-invite-hash-' || rowid`,
      });
      updateIfPresent({
        db: db,
        table: "invites",
        column: "preauthEmail",
        expression: `CASE WHEN preauthEmail IS NULL THEN NULL ELSE 'invite-' || rowid || '@example.invalid' END`,
      });
      updateIfPresent({
        db: db,
        table: "capacitylens_bootstrap_claim",
        column: "claimToken",
        expression: `'rehearsal-disabled'`,
      });
      updateIfPresent({ db: db, table: "account_commands", column: "applicationId", expression: `'rehearsal-app'` });
      updateIfPresent({
        db: db,
        table: "account_commands",
        column: "operation",
        expression: `'rehearsal-operation-' || rowid`,
      });
      updateIfPresent({
        db: db,
        table: "account_commands",
        column: "idempotencyKey",
        expression: `'rehearsal-key-' || rowid`,
      });
      updateIfPresent({
        db: db,
        table: "account_commands",
        column: "payloadHash",
        expression: `lower(hex(zeroblob(32)))`,
      });
      updateIfPresent({
        db: db,
        table: "account_commands",
        column: "resultJson",
        expression: `CASE
         WHEN status = 'pending' THEN NULL
         WHEN status = 'completed' THEN '{}'
         WHEN resultJson IS NULL THEN NULL
         ELSE '{"kind":"rehearsal-redacted"}'
       END`,
      });
      updateIfPresent({
        db: db,
        table: "account_federated_provider_bindings",
        column: "applicationId",
        expression: `'rehearsal-app'`,
      });
      updateIfPresent({
        db: db,
        table: "account_federated_provider_bindings",
        column: "issuer",
        expression: `'https://idp-' || rowid || '.example.invalid'`,
      });
      for (const trigger of triggers) db.exec(trigger.sql);
    },
    "immediate",
  );

  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) throw new Error(`anonymised copy has ${violations.length} foreign-key violation(s)`);
  // secure_delete was enabled before the transaction, so replaced/deleted values are overwritten
  // without rebuilding the file. Preserve the copied operator database's page layout and journal
  // mode: the rehearsal must exercise the physical shape it was given.
}
