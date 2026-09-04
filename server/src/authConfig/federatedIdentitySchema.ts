import type { Db } from "../db";
import type { ObservedFederatedLink } from "../federatedLinkLifecycle";
import {
  FEDERATED_SUBJECT_UNIQUE_INDEX,
  FEDERATED_PRINCIPAL_PROVIDER_UNIQUE_INDEX,
  FEDERATED_OBSERVATION_TRIGGER,
} from "./authConstants";

/** Unreleased v25 application migration definition. The CapacityLens-owned tables make provider
 * callbacks recoverable and their audits at-least-once. The account indexes close Better Auth's
 * subject and per-principal find-then-create races; the trigger records a verified external row in
 * the same SQLite statement that creates it, including direct OIDC admissions. */
export const FEDERATED_IDENTITY_V25_DEFINITION = `
CREATE TABLE IF NOT EXISTS capacitylens_federated_link_ceremonies (
  id TEXT NOT NULL PRIMARY KEY,
  principalId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  completedAt TEXT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_capacitylens_federated_link_ceremonies_principal
  ON capacitylens_federated_link_ceremonies(principalId, providerId);
CREATE TABLE IF NOT EXISTS capacitylens_federated_link_observations (
  accountRowId TEXT NOT NULL PRIMARY KEY,
  principalId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  subject TEXT NOT NULL,
  verifiedAt TEXT NOT NULL,
  auditedAt TEXT,
  UNIQUE(providerId, subject)
) STRICT;
CREATE TABLE IF NOT EXISTS capacitylens_sso_cutover_state (
  applicationId TEXT NOT NULL PRIMARY KEY,
  activatedAt TEXT NOT NULL
) STRICT;
guard:sqlite_master(account):reject-duplicate-provider-coordinates:v2
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider_subject_unique ON account(providerId, accountId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_principal_provider_unique ON account(userId, providerId);
CREATE TRIGGER IF NOT EXISTS capacitylens_observe_federated_account
AFTER INSERT ON account
WHEN NEW.providerId <> 'credential'
BEGIN
  INSERT INTO capacitylens_federated_link_observations
    (accountRowId, principalId, providerId, subject, verifiedAt, auditedAt)
  VALUES (NEW.id, NEW.userId, NEW.providerId, NEW.accountId, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL);
END;
`;

function federatedObservationTriggerSql(): string {
  const marker = `CREATE TRIGGER IF NOT EXISTS ${FEDERATED_OBSERVATION_TRIGGER}`;
  const start = FEDERATED_IDENTITY_V25_DEFINITION.indexOf(marker);
  if (start < 0) throw new Error("The v25 identity definition is missing its observation trigger.");
  return FEDERATED_IDENTITY_V25_DEFINITION.slice(start).trim();
}

/** SQLite removes IF NOT EXISTS from sqlite_master but otherwise retains the trigger definition. */
function expectedStoredFederatedObservationTriggerSql(): string {
  return federatedObservationTriggerSql()
    .replace(/^CREATE TRIGGER IF NOT EXISTS\s+/, "CREATE TRIGGER ")
    .replace(/;\s*$/, "");
}

function normalizeSchemaSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sqliteTableExists(db: Db, table: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined;
}

/** Immutable implementation shared by the unreleased v25 ledger step and its same-version
 * post-Better-Auth repair pass. Future schema versions must compose a new helper rather than edit
 * this one, preserving the shipped migration definition and behavior together. */
function installFederatedIdentityV25(db: Db): void {
  db.exec(
    FEDERATED_IDENTITY_V25_DEFINITION.slice(
      0,
      FEDERATED_IDENTITY_V25_DEFINITION.indexOf("guard:sqlite_master(account)"),
    ),
  );
  if (!sqliteTableExists(db, "account")) return;

  const duplicate = db
    .prepare(
      `SELECT a.providerId, a.accountId, GROUP_CONCAT(a.userId, ', ') AS principalIds,
              GROUP_CONCAT(COALESCE(u.email, a.userId), ', ') AS people
         FROM account AS a
         LEFT JOIN user AS u ON u.id = a.userId
        GROUP BY a.providerId, a.accountId
       HAVING COUNT(*) > 1
        LIMIT 1`,
    )
    .get() as { providerId: string; accountId: string; principalIds: string; people: string } | undefined;
  if (duplicate) {
    throw new Error(
      `Federated subject duplication blocks the SSO migration — provider ${duplicate.providerId}, ` +
        `subject ${duplicate.accountId}, principals ${duplicate.principalIds} (${duplicate.people}). ` +
        "Reconcile the incorrect provider link before retrying.",
    );
  }
  const repeatedProvider = db
    .prepare(
      `SELECT a.userId, a.providerId, GROUP_CONCAT(a.accountId, ', ') AS subjects,
              COALESCE(u.email, a.userId) AS person
         FROM account AS a
         LEFT JOIN user AS u ON u.id = a.userId
        GROUP BY a.userId, a.providerId
       HAVING COUNT(*) > 1
        LIMIT 1`,
    )
    .get() as { userId: string; providerId: string; subjects: string; person: string } | undefined;
  if (repeatedProvider) {
    throw new Error(
      `Multiple provider links block the SSO migration — principal ${repeatedProvider.userId} ` +
        `(${repeatedProvider.person}), provider ${repeatedProvider.providerId}, subjects ${repeatedProvider.subjects}. ` +
        "Remove the incorrect exact provider row before retrying.",
    );
  }

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${FEDERATED_SUBJECT_UNIQUE_INDEX} ON account(providerId, accountId);`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${FEDERATED_PRINCIPAL_PROVIDER_UNIQUE_INDEX} ON account(userId, providerId);`,
  );
  db.exec(federatedObservationTriggerSql());
}

/** Apply only the frozen v25 identity migration. */
export function migrateFederatedIdentityV25(db: Db): void {
  installFederatedIdentityV25(db);
}

/** Install/verify the current application-owned backstop around Better Auth's provider-account
 * table. App migrations run before Better Auth creates tables on a fresh auth-enabled database,
 * so this is deliberately idempotent and is also called immediately after auth migrations. */
export function ensureFederatedIdentitySchema(db: Db): void {
  installFederatedIdentityV25(db);
}

/** Fail unless every v25 identity table, index, and trigger has the exact owned shape. */
export function assertFederatedIdentitySchemaCurrent(db: Db): void {
  const expectedTables = new Map([
    [
      "capacitylens_federated_link_ceremonies",
      [
        ["id", "TEXT", 1, 1],
        ["principalId", "TEXT", 1, 0],
        ["providerId", "TEXT", 1, 0],
        ["createdAt", "TEXT", 1, 0],
        ["expiresAt", "TEXT", 1, 0],
        ["completedAt", "TEXT", 0, 0],
      ],
    ],
    [
      "capacitylens_federated_link_observations",
      [
        ["accountRowId", "TEXT", 1, 1],
        ["principalId", "TEXT", 1, 0],
        ["providerId", "TEXT", 1, 0],
        ["subject", "TEXT", 1, 0],
        ["verifiedAt", "TEXT", 1, 0],
        ["auditedAt", "TEXT", 0, 0],
      ],
    ],
    [
      "capacitylens_sso_cutover_state",
      [
        ["applicationId", "TEXT", 1, 1],
        ["activatedAt", "TEXT", 1, 0],
      ],
    ],
  ] as const);
  for (const [table, expectedColumns] of expectedTables) {
    const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
      { sql: string } | undefined;
    if (!schema) throw new Error(`DB identity schema is missing ${table}.`);
    const columns = (
      db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>
    ).map(({ name, type, notnull, pk }) => [name, type, notnull, pk]);
    if (JSON.stringify(columns) !== JSON.stringify(expectedColumns) || !/\)\s*STRICT\s*$/i.test(schema.sql)) {
      throw new Error(`DB identity schema has an invalid ${table} definition.`);
    }
  }
  const ceremonyIndexes = db.prepare(`PRAGMA index_list(capacitylens_federated_link_ceremonies)`).all() as Array<{
    name: string;
    unique: number;
  }>;
  const ceremonyColumns = db
    .prepare(`PRAGMA index_info(idx_capacitylens_federated_link_ceremonies_principal)`)
    .all() as Array<{ name: string }>;
  if (
    !ceremonyIndexes.some(
      ({ name, unique }) => name === "idx_capacitylens_federated_link_ceremonies_principal" && unique === 1,
    ) ||
    ceremonyColumns.map(({ name }) => name).join(",") !== "principalId,providerId"
  ) {
    throw new Error("DB identity schema has an invalid federated-link ceremony index definition.");
  }
  const observationIndexes = db.prepare(`PRAGMA index_list(capacitylens_federated_link_observations)`).all() as Array<{
    name: string;
    unique: number;
    origin: string;
  }>;
  const hasProviderSubjectConstraint = observationIndexes.some(({ name, unique, origin }) => {
    if (unique !== 1 || origin !== "u") return false;
    const columns = db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name: string }>;
    return columns.map(({ name: column }) => column).join(",") === "providerId,subject";
  });
  if (!hasProviderSubjectConstraint) {
    throw new Error("DB identity schema is missing the provider-subject observation constraint.");
  }
  if (!sqliteTableExists(db, "account")) return;
  const accountIndexes = db.prepare(`PRAGMA index_list(account)`).all() as Array<{ name: string; unique: number }>;
  for (const [indexName, expectedColumns] of [
    [FEDERATED_SUBJECT_UNIQUE_INDEX, "providerId,accountId"],
    [FEDERATED_PRINCIPAL_PROVIDER_UNIQUE_INDEX, "userId,providerId"],
  ] as const) {
    const columns = db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{ name: string }>;
    const unique = accountIndexes.some((index) => index.name === indexName && index.unique === 1);
    if (!unique || columns.map(({ name }) => name).join(",") !== expectedColumns) {
      throw new Error(`DB identity schema has an invalid ${indexName} definition.`);
    }
  }
  const trigger = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`)
    .get(FEDERATED_OBSERVATION_TRIGGER) as { sql: string } | undefined;
  if (
    !trigger ||
    normalizeSchemaSql(trigger.sql) !== normalizeSchemaSql(expectedStoredFederatedObservationTriggerSql())
  ) {
    throw new Error(`DB identity schema has an invalid ${FEDERATED_OBSERVATION_TRIGGER} definition.`);
  }
}

/** Identity-adapter-owned read that proves an observation still names the exact live provider
 * account row before the lifecycle service emits its durable audit. */
export function verifiedUnauditedFederatedLinks(db: Db): readonly ObservedFederatedLink[] {
  return db
    .prepare(
      `SELECT observation.accountRowId, observation.principalId, observation.providerId,
              observation.subject, observation.verifiedAt
         FROM capacitylens_federated_link_observations AS observation
         JOIN account AS providerAccount
           ON providerAccount.id = observation.accountRowId
          AND providerAccount.userId = observation.principalId
          AND providerAccount.providerId = observation.providerId
          AND providerAccount.accountId = observation.subject
        WHERE observation.auditedAt IS NULL
        ORDER BY observation.verifiedAt, observation.accountRowId`,
    )
    .all() as unknown as ObservedFederatedLink[];
}
