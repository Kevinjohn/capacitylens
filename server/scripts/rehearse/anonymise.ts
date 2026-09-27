import type { DatabaseSync } from "node:sqlite";
import { parseApprovedDomain } from "@capacitylens/shared/account/approvedDomains";
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

function canonicalAddress(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalDomainForAddress(value: string): string | null {
  const normalized = canonicalAddress(value);
  const separator = normalized.lastIndexOf("@");
  return separator < 0 ? null : parseApprovedDomain(normalized.slice(separator + 1));
}

function uniqueUserAliasFor(addressAliases: ReadonlyMap<string, string>): (value: string) => string | null {
  const usedVariants = new Map<string, number>();
  return (value) => {
    const normalized = canonicalAddress(value);
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

interface IdentityAddressRows {
  restrictions: Array<{ rowId: number; verifiedEmail: string }>;
  proofs: Array<{ rowId: number; email: string }>;
  users: Array<{ rowId: number; email: string }>;
  invitations: Array<{ rowId: number; preauthEmail: string }>;
  policies: Array<{ rowId: number; approvedDomains: string }>;
}

function readIdentityAddressRows(db: DatabaseSync): IdentityAddressRows {
  return {
    restrictions: hasTable(db, "account_access_restrictions")
      ? (db
          .prepare(
            `SELECT rowid AS rowId, verifiedEmail FROM account_access_restrictions
        WHERE verifiedEmail IS NOT NULL ORDER BY rowid`,
          )
          .all() as Array<{ rowId: number; verifiedEmail: string }>)
      : [],
    proofs: hasTable(db, "identity_email_proofs")
      ? (db.prepare(`SELECT rowid AS rowId, email FROM identity_email_proofs ORDER BY rowid`).all() as Array<{
          rowId: number;
          email: string;
        }>)
      : [],
    users:
      hasTable(db, "user") && readColumnNames(db, "user").has("email")
        ? (db.prepare("SELECT rowid AS rowId, email FROM user").all() as Array<{ rowId: number; email: string }>)
        : [],
    invitations:
      hasTable(db, "invites") && readColumnNames(db, "invites").has("preauthEmail")
        ? (db
            .prepare("SELECT rowid AS rowId, preauthEmail FROM invites WHERE preauthEmail IS NOT NULL ORDER BY rowid")
            .all() as Array<{ rowId: number; preauthEmail: string }>)
        : [],
    policies:
      hasTable(db, "account_joining_policies") && readColumnNames(db, "account_joining_policies").has("approvedDomains")
        ? (db
            .prepare("SELECT rowid AS rowId, approvedDomains FROM account_joining_policies ORDER BY rowid")
            .all() as Array<{
            rowId: number;
            approvedDomains: string;
          }>)
        : [],
  };
}

function parseSourceApprovedDomains(policies: IdentityAddressRows["policies"]): string[] {
  return policies.flatMap(({ approvedDomains: value }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error("Invalid approved domain list in rehearsal source.");
    }
    if (!Array.isArray(parsed)) throw new Error("Invalid approved domain list in rehearsal source.");
    return parsed.flatMap((candidate) => {
      const domain = parseApprovedDomain(candidate);
      if (domain === null) throw new Error("Invalid approved domain in rehearsal source.");
      return [domain];
    });
  });
}

function buildDomainAliases(emails: readonly string[], approvedDomains: readonly string[]): Map<string, string> {
  const domains = new Set(approvedDomains);
  for (const email of emails) {
    const domain = canonicalDomainForAddress(email);
    if (domain !== null) domains.add(domain);
  }
  return new Map([...domains].sort().map((domain, index) => [domain, `rehearsal-domain-${index + 1}.example.invalid`]));
}

function buildAddressAliases(
  emails: readonly string[],
  domainAliases: ReadonlyMap<string, string>,
): Map<string, string> {
  const addressAliases = new Map<string, string>();
  for (const [index, value] of emails.entries()) {
    const normalized = canonicalAddress(value);
    if (!addressAliases.has(normalized)) {
      const domain = canonicalDomainForAddress(normalized);
      const domainAlias = domain === null ? "example.invalid" : domainAliases.get(domain);
      if (!domainAlias) throw new Error("Missing rehearsal email domain alias.");
      addressAliases.set(normalized, `rehearsal-proof-${index + 1}@${domainAlias}`);
    }
  }
  return addressAliases;
}

function updateEmailRows(
  db: DatabaseSync,
  rows: IdentityAddressRows,
  addressAliases: ReadonlyMap<string, string>,
): void {
  const alias = (value: string): string => {
    const mapped = addressAliases.get(canonicalAddress(value));
    if (!mapped) throw new Error("Missing rehearsal email alias.");
    return mapped;
  };
  const uniqueUserAlias = uniqueUserAliasFor(addressAliases);
  if (rows.users.length > 0) {
    const updateUser = db.prepare("UPDATE user SET email = ? WHERE rowid = ?");
    for (const user of rows.users) {
      const address = uniqueUserAlias(user.email);
      updateUser.run(address ?? `rehearsal-user-${user.rowId}@example.invalid`, user.rowId);
    }
  }
  if (rows.restrictions.length > 0) {
    const updateRestriction = db.prepare("UPDATE account_access_restrictions SET verifiedEmail = ? WHERE rowid = ?");
    for (const restriction of rows.restrictions) {
      updateRestriction.run(alias(restriction.verifiedEmail), restriction.rowId);
    }
  }
  if (rows.proofs.length > 0) {
    const updateProof = db.prepare("UPDATE identity_email_proofs SET email = ? WHERE rowid = ?");
    for (const proof of rows.proofs) updateProof.run(alias(proof.email), proof.rowId);
  }
  if (rows.invitations.length > 0) {
    const updateInvitation = db.prepare("UPDATE invites SET preauthEmail = ? WHERE rowid = ?");
    for (const invitation of rows.invitations) updateInvitation.run(alias(invitation.preauthEmail), invitation.rowId);
  }
}

function updateApprovedDomainRows(
  db: DatabaseSync,
  policies: IdentityAddressRows["policies"],
  domainAliases: ReadonlyMap<string, string>,
): void {
  if (policies.length > 0) {
    const updatePolicy = db.prepare("UPDATE account_joining_policies SET approvedDomains = ? WHERE rowid = ?");
    for (const policy of policies) {
      const parsed = JSON.parse(policy.approvedDomains) as unknown[];
      const mapped = parsed.map((candidate) => {
        const domain = parseApprovedDomain(candidate);
        const replacement = domain === null ? null : domainAliases.get(domain);
        if (!replacement) throw new Error("Missing rehearsal approved domain alias.");
        return replacement;
      });
      updatePolicy.run(JSON.stringify([...new Set(mapped)].sort()), policy.rowId);
    }
  }
}

// One pass shares aliases across restrictions, recreated identities, invitations, and proof rows.
// Domain aliases keep approved-domain admission equivalent in the rehearsal.
function anonymiseIdentityAddresses(db: DatabaseSync): void {
  const rows = readIdentityAddressRows(db);
  const emails = [
    ...rows.restrictions.map((row) => row.verifiedEmail),
    ...rows.proofs.map((row) => row.email),
    ...rows.users.map((row) => row.email),
    ...rows.invitations.map((row) => row.preauthEmail),
  ];
  const domainAliases = buildDomainAliases(emails, parseSourceApprovedDomains(rows.policies));
  updateEmailRows(db, rows, buildAddressAliases(emails, domainAliases));
  updateApprovedDomainRows(db, rows.policies, domainAliases);
}

function anonymiseIdentityData(db: DatabaseSync, hasProviderCoordinates: boolean): void {
  // Build one alias per original proven address before redacting either side. A recreated
  // principal may hold the restricted address while the original principal has since changed it.
  anonymiseIdentityAddresses(db);
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
