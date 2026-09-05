import type { DatabaseSync } from "node:sqlite";
import { tx } from "../../src/txn";
import { KNOWN_COLUMNS, KNOWN_TABLES } from "./knownColumns";
import { quoteIdentifier, tableNames, columns, hasTable } from "./sqliteIntrospection";

function updateIfPresent(db: DatabaseSync, table: string, column: string, expression: string): void {
  if (!hasTable(db, table) || !columns(db, table).has(column)) return;
  db.exec(`UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column)} = ${expression}`);
}

interface Reference {
  table: string;
  column: string;
}

let remapSequence = 0;

/** Remap opaque ids as well as visible text. This preserves relationships while ensuring a
 * retained rehearsal directory cannot be joined back to ids from the source installation. */
export function remapIds(db: DatabaseSync, table: string, idColumn: string, references: Reference[]): void {
  if (!hasTable(db, table) || !columns(db, table).has(idColumn)) return;
  const values = db
    .prepare(
      `SELECT ${quoteIdentifier(idColumn)} AS id FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(idColumn)}`,
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
        (reference) => hasTable(db, reference.table) && columns(db, reference.table).has(reference.column),
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
export function scrubDanglingReferences(
  db: DatabaseSync,
  parentTable: string,
  parentColumn: string,
  references: Reference[],
  label: string,
): void {
  for (const reference of references) {
    if (!hasTable(db, reference.table) || !columns(db, reference.table).has(reference.column)) continue;
    const table = quoteIdentifier(reference.table);
    const column = quoteIdentifier(reference.column);
    const replacement = `'rehearsal-dangling-${label}-' || rowid`;
    if (!hasTable(db, parentTable) || !columns(db, parentTable).has(parentColumn)) {
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

/** Sanitise only a temporary online snapshot. Unknown tables fail closed so a new auth/plugin table
 * cannot carry secrets into a kept rehearsal directory until the redaction policy covers it. */
export function anonymise(db: DatabaseSync): void {
  const unknown = tableNames(db).filter((table) => !KNOWN_TABLES.has(table));
  if (unknown.length > 0) {
    throw new Error(`anonymiser does not cover table(s): ${unknown.join(", ")}`);
  }
  const unknownColumns = tableNames(db).flatMap((table) =>
    [...columns(db, table)]
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
        ["id", "accountId", "userId", "providerId"].every((column) => columns(db, "account").has(column));
      // Preserve the original admission proof before remapping any identity coordinates.
      // A stale subject, principal or provider must never become a valid proof after scrubbing.
      updateIfPresent(
        db,
        "capacitylens_federated_link_observations",
        "subject",
        hasProviderCoordinates
          ? `COALESCE((SELECT 'rehearsal-provider-account-' || account.rowid FROM account
              WHERE account.id = capacitylens_federated_link_observations.accountRowId
                AND account.accountId = capacitylens_federated_link_observations.subject
                AND account.userId = capacitylens_federated_link_observations.principalId
                AND account.providerId = capacitylens_federated_link_observations.providerId),
              'rehearsal-orphan-subject-' || rowid)`
          : `'rehearsal-orphan-subject-' || rowid`,
      );
      remapIds(db, "accounts", "id", [
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
        { table: "invites", column: "accountId" },
        { table: "account_commands", column: "workspaceId" },
        { table: "capacitylens_sync_row_provenance", column: "accountId" },
      ]);
      remapIds(db, "clients", "id", [{ table: "projects", column: "clientId" }]);
      remapIds(db, "disciplines", "id", [{ table: "resources", column: "disciplineId" }]);
      remapIds(db, "projects", "id", [
        { table: "phases", column: "projectId" },
        { table: "resources", column: "projectId" },
        { table: "activities", column: "projectId" },
        { table: "tasks", column: "projectId" },
        { table: "allocations", column: "projectId" },
      ]);
      remapIds(db, "phases", "id", [
        { table: "activities", column: "phaseId" },
        { table: "tasks", column: "phaseId" },
      ]);
      remapIds(db, "resources", "id", [
        { table: "allocations", column: "resourceId" },
        { table: "timeOff", column: "resourceId" },
      ]);
      remapIds(db, hasTable(db, "activities") ? "activities" : "tasks", "id", [
        {
          table: "allocations",
          column: hasTable(db, "activities") ? "activityId" : "taskId",
        },
      ]);
      remapIds(db, "allocations", "id", []);
      remapIds(db, "timeOff", "id", []);
      remapIds(db, "closures", "id", []);
      remapIds(db, "user", "id", [
        { table: "account", column: "userId" },
        { table: "session", column: "userId" },
        { table: "twoFactor", column: "userId" },
        { table: "account_members", column: "userId" },
        { table: "account_security_revisions", column: "principalId" },
        { table: "account_commands", column: "actorPrincipalId" },
        { table: "account_commands", column: "targetPrincipalId" },
        { table: "account_session_assurance", column: "principalId" },
        { table: "capacitylens_federated_link_ceremonies", column: "principalId" },
        { table: "capacitylens_federated_link_observations", column: "principalId" },
        // Better Auth password-reset ceremonies join through value = user.id. Preserve that
        // relationship under the rehearsal-safe id so migrations v12/v14 exercise their deletes.
        { table: "verification", column: "value" },
      ]);
      remapIds(db, "account", "id", [{ table: "capacitylens_federated_link_observations", column: "accountRowId" }]);
      remapIds(db, "capacitylens_federated_link_ceremonies", "id", []);
      scrubDanglingReferences(
        db,
        "account",
        "id",
        [{ table: "capacitylens_federated_link_observations", column: "accountRowId" }],
        "provider-account",
      );
      // Assurance keys are application-scoped hashes of bearer session tokens, not Better Auth row
      // ids, so anonymise the two namespaces independently.
      remapIds(db, "session", "id", []);
      remapIds(db, "twoFactor", "id", []);
      remapIds(db, "verification", "id", []);
      remapIds(db, "invites", "id", []);
      remapIds(db, "account_commands", "commandId", []);
      remapIds(db, "account_session_assurance", "sessionId", []);
      remapIds(db, "account_federated_provider_bindings", "providerId", [
        { table: "account", column: "providerId" },
        { table: "account_session_assurance", column: "providerId" },
        { table: "capacitylens_federated_link_ceremonies", column: "providerId" },
        { table: "capacitylens_federated_link_observations", column: "providerId" },
      ]);
      scrubDanglingReferences(
        db,
        "accounts",
        "id",
        [
          { table: "account_members", column: "accountId" },
          { table: "account_member_sign_in_tracking", column: "accountId" },
          { table: "invites", column: "accountId" },
          { table: "account_commands", column: "workspaceId" },
        ],
        "workspace",
      );
      scrubDanglingReferences(
        db,
        "user",
        "id",
        [
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
        "principal",
      );
      // Credential rows and stale/legacy federated rows do not necessarily have a corresponding
      // application binding. Their providerId still identifies the source installation, so scrub
      // every value that the binding remap above could not resolve.
      scrubDanglingReferences(
        db,
        "account_federated_provider_bindings",
        "providerId",
        [
          { table: "account", column: "providerId" },
          { table: "account_session_assurance", column: "providerId" },
          { table: "capacitylens_federated_link_ceremonies", column: "providerId" },
          { table: "capacitylens_federated_link_observations", column: "providerId" },
        ],
        "provider",
      );

      updateIfPresent(db, "accounts", "name", `'Rehearsal Account ' || rowid`);
      updateIfPresent(
        db,
        "clients",
        "name",
        columns(db, "clients").has("builtin")
          ? `CASE WHEN builtin = 'true' THEN 'Internal' ELSE 'Rehearsal Client ' || rowid END`
          : `'Rehearsal Client ' || rowid`,
      );
      updateIfPresent(db, "clients", "codeName", `CASE WHEN codeName IS NULL THEN NULL ELSE 'Client ' || rowid END`);
      updateIfPresent(db, "disciplines", "name", `'Rehearsal Discipline ' || rowid`);
      updateIfPresent(db, "projects", "name", `'Rehearsal Project ' || rowid`);
      updateIfPresent(db, "projects", "codeName", `CASE WHEN codeName IS NULL THEN NULL ELSE 'Project ' || rowid END`);
      updateIfPresent(db, "phases", "name", `'Rehearsal Phase ' || rowid`);
      updateIfPresent(
        db,
        "resources",
        "name",
        `CASE WHEN name IS NULL THEN NULL ELSE 'Rehearsal Resource ' || rowid END`,
      );
      updateIfPresent(db, "resources", "role", `'Rehearsal Role ' || rowid`);
      updateIfPresent(
        db,
        hasTable(db, "activities") ? "activities" : "tasks",
        "name",
        `'Rehearsal Activity ' || rowid`,
      );
      updateIfPresent(db, "allocations", "note", "NULL");
      updateIfPresent(db, "timeOff", "note", "NULL");
      updateIfPresent(db, "closures", "name", `'Rehearsal Closure ' || rowid`);
      // Preserve scheduling flags, working days, half-days, engagement, series grouping and dates.
      updateIfPresent(db, "capacitylens_audit_outbox", "id", `'rehearsal-audit-' || rowid`);
      updateIfPresent(db, "capacitylens_audit_outbox", "payload", `'{}'`);
      remapIds(db, "capacitylens_sync_sessions", "sessionId", [
        { table: "capacitylens_sync_row_provenance", column: "sessionId" },
      ]);
      updateIfPresent(db, "capacitylens_sync_row_provenance", "rowId", `'rehearsal-sync-row-' || rowid`);
      updateIfPresent(db, "capacitylens_sync_row_provenance", "rowHash", `lower(hex(zeroblob(32)))`);

      updateIfPresent(db, "user", "name", `'Rehearsal User ' || rowid`);
      updateIfPresent(db, "user", "email", `'rehearsal-user-' || rowid || '@example.invalid'`);
      updateIfPresent(db, "user", "image", "NULL");
      updateIfPresent(db, "account", "accountId", `'rehearsal-provider-account-' || rowid`);
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
      remapIds(db, "capacitylens_sso_cutover_state", "applicationId", []);
      // Identity timestamps and completion/audit flags are retained; ceremony ids are disabled
      // by remapping and provider/principal coordinates are remapped or scrubbed above.
      for (const secret of ["accessToken", "refreshToken", "idToken", "password"]) {
        updateIfPresent(db, "account", secret, "NULL");
      }
      updateIfPresent(db, "session", "token", `'rehearsal-session-' || rowid`);
      updateIfPresent(db, "session", "ipAddress", "NULL");
      updateIfPresent(db, "session", "userAgent", `'Rehearsal'`);
      updateIfPresent(db, "twoFactor", "secret", `'rehearsal-disabled-' || rowid`);
      updateIfPresent(db, "twoFactor", "backupCodes", `'[]'`);
      updateIfPresent(db, "verification", "identifier", `'rehearsal-verification-' || rowid`);
      updateIfPresent(db, "invites", "token", `'rehearsal-invite-' || rowid`);
      updateIfPresent(db, "invites", "tokenHash", `'rehearsal-invite-hash-' || rowid`);
      updateIfPresent(
        db,
        "invites",
        "preauthEmail",
        `CASE WHEN preauthEmail IS NULL THEN NULL ELSE 'invite-' || rowid || '@example.invalid' END`,
      );
      updateIfPresent(db, "capacitylens_bootstrap_claim", "claimToken", `'rehearsal-disabled'`);
      updateIfPresent(db, "account_commands", "applicationId", `'rehearsal-app'`);
      updateIfPresent(db, "account_commands", "operation", `'rehearsal-operation-' || rowid`);
      updateIfPresent(db, "account_commands", "idempotencyKey", `'rehearsal-key-' || rowid`);
      updateIfPresent(db, "account_commands", "payloadHash", `lower(hex(zeroblob(32)))`);
      updateIfPresent(
        db,
        "account_commands",
        "resultJson",
        `CASE
         WHEN status = 'pending' THEN NULL
         WHEN status = 'completed' THEN '{}'
         WHEN resultJson IS NULL THEN NULL
         ELSE '{"kind":"rehearsal-redacted"}'
       END`,
      );
      updateIfPresent(db, "account_federated_provider_bindings", "applicationId", `'rehearsal-app'`);
      updateIfPresent(
        db,
        "account_federated_provider_bindings",
        "issuer",
        `'https://idp-' || rowid || '.example.invalid'`,
      );
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
