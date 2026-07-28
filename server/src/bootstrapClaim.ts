import type { Db } from './db'

export const BOOTSTRAP_CLAIM_TABLE = 'capacitylens_bootstrap_claim'

/** Canonical application-owned table used to serialize first-owner identity creation. */
export const BOOTSTRAP_CLAIM_TABLE_SQL = `
CREATE TABLE capacitylens_bootstrap_claim (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  claimedAt TEXT NOT NULL,
  claimToken TEXT NOT NULL
);
`

const LEGACY_BOOTSTRAP_CLAIM_TABLE_SQL = `
CREATE TABLE capacitylens_bootstrap_claim (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  claimedAt TEXT NOT NULL
);
`

const ALTERED_BOOTSTRAP_CLAIM_TABLE_SQL = `
CREATE TABLE capacitylens_bootstrap_claim (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  claimedAt TEXT NOT NULL,
  claimToken TEXT
);
`

/** Immutable v20 manifest. The named repair is deliberately limited to the two table definitions
 * previously emitted by CapacityLens; arbitrary schema drift is rejected instead of guessed at. */
export const BOOTSTRAP_CLAIM_V20_DEFINITION = [
  BOOTSTRAP_CLAIM_TABLE_SQL,
  LEGACY_BOOTSTRAP_CLAIM_TABLE_SQL,
  ALTERED_BOOTSTRAP_CLAIM_TABLE_SQL,
  'repair:replace-known-legacy-bootstrap-claim-shapes-and-clear-ephemeral-claim:v1',
  'assert:exact-bootstrap-claim-table-definition:v1',
].join('\n-- migration component --\n')

type BootstrapClaimShape = 'missing' | 'current' | 'legacy' | 'altered-legacy' | 'invalid'

function normalizeTableSql(sql: string): string {
  return sql
    .toLowerCase()
    .replace(/\bif\s+not\s+exists\b/g, '')
    .replaceAll('"', '')
    .replaceAll('`', '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/\s+/g, '')
    .replace(/;$/, '')
}

const CURRENT_SIGNATURE = normalizeTableSql(BOOTSTRAP_CLAIM_TABLE_SQL)
const LEGACY_SIGNATURE = normalizeTableSql(LEGACY_BOOTSTRAP_CLAIM_TABLE_SQL)
const ALTERED_LEGACY_SIGNATURE = normalizeTableSql(ALTERED_BOOTSTRAP_CLAIM_TABLE_SQL)

function bootstrapClaimShape(db: Db): BootstrapClaimShape {
  const entry = db.prepare(
    `SELECT type, sql FROM sqlite_master WHERE name = ?`,
  ).get(BOOTSTRAP_CLAIM_TABLE) as { type: string; sql: string | null } | undefined
  if (!entry) return 'missing'
  if (entry.type !== 'table' || !entry.sql) return 'invalid'

  const signature = normalizeTableSql(entry.sql)
  if (signature === CURRENT_SIGNATURE) return 'current'
  if (signature === LEGACY_SIGNATURE) return 'legacy'
  if (signature === ALTERED_LEGACY_SIGNATURE) return 'altered-legacy'
  return 'invalid'
}

/** Apply the checksummed v20 repair. Known legacy rows are five-minute coordination leases and
 * cannot be authenticated without a non-null token, so the repair intentionally clears them while
 * replacing the old table. An exact current table, including any live claim, is left untouched.
 *
 * @throws When a same-named object has any shape CapacityLens did not previously emit. */
export function migrateBootstrapClaimV20(db: Db): void {
  const shape = bootstrapClaimShape(db)
  if (shape === 'missing') {
    db.exec(BOOTSTRAP_CLAIM_TABLE_SQL)
    return
  }
  if (shape === 'current') return
  if (shape === 'invalid') {
    throw new Error(
      `${BOOTSTRAP_CLAIM_TABLE} has an unknown schema; refusing unsafe automatic repair.`,
    )
  }

  db.exec(`DROP TABLE ${BOOTSTRAP_CLAIM_TABLE};`)
  db.exec(BOOTSTRAP_CLAIM_TABLE_SQL)
}

/** Assert the complete app-owned bootstrap-claim definition, including column order, types,
 * nullability, primary key and the singleton CHECK constraint.
 *
 * @throws When the table is absent or its stored DDL differs from the v20 definition. */
export function assertBootstrapClaimCurrent(db: Db): void {
  if (bootstrapClaimShape(db) !== 'current') {
    throw new Error(`${BOOTSTRAP_CLAIM_TABLE} does not match the current application schema.`)
  }
}
