import type { AccountErrorCode } from '@capacitylens/shared/account/errors'
import { ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS } from '@capacitylens/shared/account/sessionPolicy'
import type { CommandId, IdempotencyKey, PrincipalId, WorkspaceId } from '@capacitylens/shared/account/types'
import type { Db } from '../db'

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
`

const CURRENT_ACCOUNT_BOUNDARY_STATE_SQL = ACCOUNT_BOUNDARY_STATE_V15_SQL
const COMMAND_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const PENDING_RECONCILIATION_MS = 15 * 60 * 1000

export function ensureAccountBoundaryState(db: Db): void {
  db.exec(CURRENT_ACCOUNT_BOUNDARY_STATE_SQL)
}

export function assertAccountBoundaryStateCurrent(db: Db): void {
  const expected: Record<string, Record<string, { type: string; required: boolean; pk: number }>> = {
    account_security_revisions: {
      principalId: { type: 'TEXT', required: true, pk: 1 },
      revision: { type: 'INTEGER', required: true, pk: 0 },
      updatedAt: { type: 'TEXT', required: true, pk: 0 },
    },
    account_commands: {
      applicationId: { type: 'TEXT', required: true, pk: 1 },
      operation: { type: 'TEXT', required: true, pk: 2 },
      idempotencyKey: { type: 'TEXT', required: true, pk: 3 },
      commandId: { type: 'TEXT', required: true, pk: 0 },
      actorPrincipalId: { type: 'TEXT', required: false, pk: 0 },
      targetPrincipalId: { type: 'TEXT', required: false, pk: 0 },
      workspaceId: { type: 'TEXT', required: false, pk: 0 },
      payloadHash: { type: 'TEXT', required: true, pk: 0 },
      status: { type: 'TEXT', required: true, pk: 0 },
      resultJson: { type: 'TEXT', required: false, pk: 0 },
      failureCode: { type: 'TEXT', required: false, pk: 0 },
      createdAt: { type: 'TEXT', required: true, pk: 0 },
      updatedAt: { type: 'TEXT', required: true, pk: 0 },
    },
    account_session_assurance: {
      sessionId: { type: 'TEXT', required: true, pk: 1 },
      principalId: { type: 'TEXT', required: true, pk: 0 },
      assurance: { type: 'TEXT', required: true, pk: 0 },
      providerId: { type: 'TEXT', required: false, pk: 0 },
      createdAt: { type: 'TEXT', required: true, pk: 0 },
    },
    account_federated_provider_bindings: {
      applicationId: { type: 'TEXT', required: true, pk: 1 },
      issuer: { type: 'TEXT', required: true, pk: 2 },
      providerId: { type: 'TEXT', required: true, pk: 0 },
      createdAt: { type: 'TEXT', required: true, pk: 0 },
    },
  }
  const problems: string[] = []
  for (const [table, columns] of Object.entries(expected)) {
    const liveColumns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string
      type: string
      notnull: number
      pk: number
    }>
    const live = new Map(liveColumns.map((column) => [column.name, column]))
    for (const [name, definition] of Object.entries(columns)) {
      if (!live.has(name)) problems.push(`missing ${table}.${name}`)
      else {
        const column = live.get(name)!
        if (column.type.toUpperCase() !== definition.type) {
          problems.push(`${table}.${name} has type ${column.type} (expected ${definition.type})`)
        }
        if ((column.notnull === 1) !== definition.required) {
          problems.push(
            `${table}.${name} is ${column.notnull === 1 ? 'NOT NULL' : 'nullable'} ` +
            `(expected ${definition.required ? 'NOT NULL' : 'nullable'})`,
        )
        }
        if (column.pk !== definition.pk) {
          problems.push(`${table}.${name} has primary-key position ${column.pk} (expected ${definition.pk})`)
        }
      }
    }
    for (const column of liveColumns) {
      if (!(column.name in columns)) problems.push(`unexpected ${table}.${column.name}`)
    }
  }
  const requiredSql: Record<string, readonly string[]> = {
    account_security_revisions: [
      'principalid text not null primary key',
      'check(revision >= 0)',
      ') strict',
    ],
    account_commands: [
      'commandid text not null unique',
      'primary key (applicationid, operation, idempotencykey)',
      'check(length(payloadhash) = 64)',
      "check(status in ('pending', 'completed', 'compensated', 'reconciliation_required'))",
      'check(resultjson is null or json_valid(resultjson))',
      "(status = 'completed' and resultjson is not null and failurecode is null)",
      ') strict',
    ],
    account_session_assurance: [
      'sessionid text not null primary key',
      'principalid text not null',
      "check(assurance in ('password', 'mfa', 'federated'))",
      "(assurance = 'federated' and providerid is not null)",
      "(assurance in ('password', 'mfa') and providerid is null)",
      ') strict',
    ],
    account_federated_provider_bindings: [
      'primary key (applicationid, issuer)',
      'unique (applicationid, providerid)',
      ') strict',
    ],
  }
  for (const [table, fragments] of Object.entries(requiredSql)) {
    const sql = String((db.prepare(
      `SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?`,
    ).get(table) as { sql?: string } | undefined)?.sql ?? '').replace(/\s+/g, ' ').toLowerCase()
    for (const required of fragments) {
      if (!sql.includes(required)) problems.push(`${table} is missing constraint: ${required}`)
    }
  }
  const expectedIndexes = new Map<string, { table: string; column: string }>([
    ['idx_account_commands_status', { table: 'account_commands', column: 'status' }],
    ['idx_account_commands_updatedAt', { table: 'account_commands', column: 'updatedAt' }],
    ['idx_account_commands_workspaceId', { table: 'account_commands', column: 'workspaceId' }],
    ['idx_account_session_assurance_principalId', {
      table: 'account_session_assurance',
      column: 'principalId',
    }],
  ])
  for (const [name, { table, column }] of expectedIndexes) {
    const belongsToExpectedTable = (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{
      name: string
      unique: number
    }>).some((index) => index.name === name && index.unique === 0)
    const definition = db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name: string }>
    if (!belongsToExpectedTable || definition.length !== 1 || definition[0]?.name !== column) {
      problems.push(`index ${name} does not cover exactly ${table}.${column}`)
    }
  }
  if (problems.length > 0) {
    throw new Error(`DB account-boundary schema mismatch: ${problems.join('; ')}.`)
  }
}

export type RecordedSessionAssurance = 'password' | 'mfa' | 'federated'

export interface RecordedSessionAuthentication {
  assurance: RecordedSessionAssurance
  providerId: string | null
}

export function recordSessionAssurance(
  db: Db,
  sessionId: string,
  principalId: PrincipalId,
  assurance: RecordedSessionAssurance,
  providerId: string | null = null,
  now = new Date().toISOString(),
): void {
  if (
    (assurance === 'federated' && !providerId) ||
    (assurance !== 'federated' && providerId !== null)
  ) {
    throw new Error('Federated session assurance requires exactly one provider id.')
  }
  // Assurance rows are keyed by a non-reversible handle rather than Better Auth's bearer token,
  // so they cannot be joined to expired sessions for cascade cleanup. Bound their lifetime to the
  // same absolute session window whenever a new session is recorded.
  db.prepare(`DELETE FROM account_session_assurance WHERE createdAt < ?`).run(
    new Date(Date.parse(now) - ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS * 1000).toISOString(),
  )
  db.prepare(`
    INSERT INTO account_session_assurance (sessionId, principalId, assurance, providerId, createdAt)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      principalId = excluded.principalId, assurance = excluded.assurance,
      providerId = excluded.providerId, createdAt = excluded.createdAt
  `).run(sessionId, principalId, assurance, providerId, now)
}

export function getSessionAuthentication(db: Db, sessionId: string): RecordedSessionAuthentication | null {
  const row = db.prepare(
    `SELECT assurance, providerId FROM account_session_assurance WHERE sessionId = ?`,
  ).get(sessionId) as { assurance?: RecordedSessionAssurance; providerId?: string | null } | undefined
  return row?.assurance
    ? { assurance: row.assurance, providerId: row.providerId ?? null }
    : null
}

export function removeSessionAssurance(db: Db, sessionId: string): void {
  db.prepare(`DELETE FROM account_session_assurance WHERE sessionId = ?`).run(sessionId)
}

export function removePrincipalSessionAssurance(db: Db, principalId: PrincipalId): void {
  db.prepare(`DELETE FROM account_session_assurance WHERE principalId = ?`).run(principalId)
}

export function bindFederatedProvider(
  db: Db,
  applicationId: string,
  issuer: string,
  providerId: string,
): void {
  const byIssuer = db.prepare(`
    SELECT providerId FROM account_federated_provider_bindings
     WHERE applicationId = ? AND issuer = ?
  `).get(applicationId, issuer) as { providerId: string } | undefined
  if (byIssuer && byIssuer.providerId !== providerId) {
    throw new Error(
      `OIDC provider id is immutable for issuer ${issuer}; expected ${byIssuer.providerId}, received ${providerId}.`,
    )
  }
  const byProvider = db.prepare(`
    SELECT issuer FROM account_federated_provider_bindings
     WHERE applicationId = ? AND providerId = ?
  `).get(applicationId, providerId) as { issuer: string } | undefined
  if (byProvider && byProvider.issuer !== issuer) {
    throw new Error(
      `OIDC provider id ${providerId} is already bound to issuer ${byProvider.issuer}.`,
    )
  }
  db.prepare(`
    INSERT OR IGNORE INTO account_federated_provider_bindings
      (applicationId, issuer, providerId, createdAt)
    VALUES (?, ?, ?, ?)
  `).run(applicationId, issuer, providerId, new Date().toISOString())
}

export function providerIdForIssuer(db: Db, applicationId: string, issuer: string): string | null {
  const row = db.prepare(`
    SELECT providerId FROM account_federated_provider_bindings
     WHERE applicationId = ? AND issuer = ?
  `).get(applicationId, issuer) as { providerId: string } | undefined
  return row?.providerId ?? null
}

export function getSecurityRevision(db: Db, principalId: PrincipalId): number {
  const row = db.prepare(
    `SELECT revision FROM account_security_revisions WHERE principalId = ?`,
  ).get(principalId) as { revision?: number } | undefined
  return Number(row?.revision ?? 0)
}

export function bumpSecurityRevision(
  db: Db,
  principalId: PrincipalId,
  now = new Date().toISOString(),
): number {
  db.prepare(`
    INSERT INTO account_security_revisions (principalId, revision, updatedAt)
    VALUES (?, 1, ?)
    ON CONFLICT(principalId) DO UPDATE SET
      revision = account_security_revisions.revision + 1,
      updatedAt = excluded.updatedAt
  `).run(principalId, now)
  return getSecurityRevision(db, principalId)
}

export function removeSecurityRevision(db: Db, principalId: PrincipalId): void {
  db.prepare(`DELETE FROM account_security_revisions WHERE principalId = ?`).run(principalId)
}

export type AccountCommandStatus =
  | 'pending'
  | 'completed'
  | 'compensated'
  | 'reconciliation_required'

export interface AccountCommandRecord {
  applicationId: string
  operation: string
  idempotencyKey: IdempotencyKey
  commandId: CommandId
  actorPrincipalId: PrincipalId | null
  targetPrincipalId: PrincipalId | null
  workspaceId: WorkspaceId | null
  payloadHash: string
  status: AccountCommandStatus
  resultJson: string | null
  failureCode: AccountErrorCode | null
  createdAt: string
  updatedAt: string
}

function commandRow(row: Record<string, unknown>): AccountCommandRecord {
  return {
    applicationId: String(row.applicationId),
    operation: String(row.operation),
    idempotencyKey: String(row.idempotencyKey),
    commandId: String(row.commandId),
    actorPrincipalId: typeof row.actorPrincipalId === 'string' ? row.actorPrincipalId : null,
    targetPrincipalId: typeof row.targetPrincipalId === 'string' ? row.targetPrincipalId : null,
    workspaceId: typeof row.workspaceId === 'string' ? row.workspaceId : null,
    payloadHash: String(row.payloadHash),
    status: row.status as AccountCommandStatus,
    resultJson: typeof row.resultJson === 'string' ? row.resultJson : null,
    failureCode: typeof row.failureCode === 'string' ? row.failureCode as AccountErrorCode : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

export function getAccountCommand(
  db: Db,
  applicationId: string,
  operation: string,
  idempotencyKey: IdempotencyKey,
): AccountCommandRecord | null {
  const row = db.prepare(`
    SELECT applicationId, operation, idempotencyKey, commandId, actorPrincipalId, targetPrincipalId,
           workspaceId, payloadHash,
           status, resultJson, failureCode, createdAt, updatedAt
      FROM account_commands
     WHERE applicationId = ? AND operation = ? AND idempotencyKey = ?
  `).get(applicationId, operation, idempotencyKey) as Record<string, unknown> | undefined
  return row ? commandRow(row) : null
}

export function getAccountCommandById(
  db: Db,
  applicationId: string,
  commandId: CommandId,
): AccountCommandRecord | null {
  const row = db.prepare(`
    SELECT applicationId, operation, idempotencyKey, commandId, actorPrincipalId, targetPrincipalId,
           workspaceId, payloadHash,
           status, resultJson, failureCode, createdAt, updatedAt
      FROM account_commands
     WHERE applicationId = ? AND commandId = ?
  `).get(applicationId, commandId) as Record<string, unknown> | undefined
  return row ? commandRow(row) : null
}

function transitionStalePending(
  db: Db,
  record: AccountCommandRecord,
  nowMs: number,
): AccountCommandRecord {
  const updatedAtMs = Date.parse(record.updatedAt)
  if (
    record.status !== 'pending' ||
    (Number.isFinite(updatedAtMs) && updatedAtMs > nowMs - PENDING_RECONCILIATION_MS)
  ) return record
  finishAccountCommand(db, {
    applicationId: record.applicationId,
    operation: record.operation,
    idempotencyKey: record.idempotencyKey,
    status: 'reconciliation_required',
    failureCode: 'DEPENDENCY_UNAVAILABLE',
    resultJson: JSON.stringify({ kind: 'stale-pending' }),
    now: new Date(nowMs).toISOString(),
  })
  return getAccountCommand(
    db,
    record.applicationId,
    record.operation,
    record.idempotencyKey,
  )!
}

/** A reconciliation read is also the timeout boundary for abandoned in-flight commands. */
export function getAccountCommandByIdForReconciliation(
  db: Db,
  applicationId: string,
  commandId: CommandId,
  now = Date.now(),
): AccountCommandRecord | null {
  const record = getAccountCommandById(db, applicationId, commandId)
  return record ? transitionStalePending(db, record, now) : null
}

function getAccountCommandByGlobalId(db: Db, commandId: CommandId): AccountCommandRecord | null {
  const row = db.prepare(`
    SELECT applicationId, operation, idempotencyKey, commandId, actorPrincipalId, targetPrincipalId,
           workspaceId, payloadHash,
           status, resultJson, failureCode, createdAt, updatedAt
      FROM account_commands
     WHERE commandId = ?
  `).get(commandId) as Record<string, unknown> | undefined
  return row ? commandRow(row) : null
}

export type ReserveAccountCommandResult =
  | { kind: 'reserved'; record: AccountCommandRecord }
  | { kind: 'existing'; record: AccountCommandRecord }
  | { kind: 'conflict'; record: AccountCommandRecord }

export function reserveAccountCommand(
  db: Db,
  input: {
    applicationId: string
    operation: string
    idempotencyKey: IdempotencyKey
    commandId: CommandId
    actorPrincipalId: PrincipalId | null
    targetPrincipalId?: PrincipalId | null
    workspaceId?: WorkspaceId | null
    payloadHash: string
    now?: string
  },
): ReserveAccountCommandResult {
  if (!/^[a-f0-9]{64}$/.test(input.payloadHash)) {
    throw new Error('Account command payloadHash must be a lowercase SHA-256 digest.')
  }
  const nowMs = input.now === undefined ? Date.now() : Date.parse(input.now)
  db.prepare(`
    DELETE FROM account_commands
     WHERE status IN ('completed', 'compensated') AND updatedAt < ?
  `).run(new Date(nowMs - COMMAND_RETENTION_MS).toISOString())
  const existing = getAccountCommand(db, input.applicationId, input.operation, input.idempotencyKey)
  if (existing) {
    const reconciled = transitionStalePending(db, existing, nowMs)
    if (reconciled !== existing) {
      return reconciled.payloadHash === input.payloadHash && reconciled.commandId === input.commandId
        ? { kind: 'existing', record: reconciled }
        : { kind: 'conflict', record: reconciled }
    }
    return reconciled.payloadHash === input.payloadHash && reconciled.commandId === input.commandId
      ? { kind: 'existing', record: reconciled }
      : { kind: 'conflict', record: reconciled }
  }
  // commandId is a durable reconciliation handle and is globally unique in the frozen v15 schema.
  // Normalize reuse across a different operation/key/application instead of leaking a SQLite UNIQUE
  // failure as an unexpected 500.
  const commandIdOwner = getAccountCommandByGlobalId(db, input.commandId)
  if (commandIdOwner) return { kind: 'conflict', record: commandIdOwner }
  const now = input.now ?? new Date().toISOString()
  db.prepare(`
    INSERT INTO account_commands (
      applicationId, operation, idempotencyKey, commandId, actorPrincipalId, targetPrincipalId,
      workspaceId, payloadHash,
      status, resultJson, failureCode, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
  `).run(
    input.applicationId,
    input.operation,
    input.idempotencyKey,
    input.commandId,
    input.actorPrincipalId,
    input.targetPrincipalId ?? null,
    input.workspaceId ?? null,
    input.payloadHash,
    now,
    now,
  )
  return {
    kind: 'reserved',
    record: getAccountCommand(db, input.applicationId, input.operation, input.idempotencyKey)!,
  }
}

/** Add newly learned privacy/repair coordinates to a still-pending coordinator command. */
export function correlatePendingAccountCommand(
  db: Db,
  input: {
    applicationId: string
    operation: string
    idempotencyKey: IdempotencyKey
    workspaceId?: WorkspaceId
    targetPrincipalId?: PrincipalId
    now?: string
  },
): void {
  const row = getAccountCommand(db, input.applicationId, input.operation, input.idempotencyKey)
  if (!row || row.status !== 'pending') {
    throw new Error('Only a pending account command may receive correlation coordinates.')
  }
  if (
    input.workspaceId !== undefined &&
    row.workspaceId !== null &&
    row.workspaceId !== input.workspaceId
  ) {
    throw new Error('A pending account command cannot be rebound to another workspace.')
  }
  if (
    input.targetPrincipalId !== undefined &&
    row.targetPrincipalId !== null &&
    row.targetPrincipalId !== input.targetPrincipalId
  ) {
    throw new Error('A pending account command cannot be rebound to another principal.')
  }
  const result = db.prepare(`
    UPDATE account_commands
       SET workspaceId = COALESCE(workspaceId, ?),
           targetPrincipalId = COALESCE(targetPrincipalId, ?),
           updatedAt = ?
     WHERE applicationId = ? AND operation = ? AND idempotencyKey = ? AND status = 'pending'
  `).run(
    input.workspaceId ?? null,
    input.targetPrincipalId ?? null,
    input.now ?? new Date().toISOString(),
    input.applicationId,
    input.operation,
    input.idempotencyKey,
  )
  if (result.changes !== 1) {
    throw new Error('Pending account-command correlation was lost concurrently.')
  }
}

export function finishAccountCommandIfPending(
  db: Db,
  input: Parameters<typeof finishAccountCommand>[1],
): boolean {
  const row = getAccountCommand(db, input.applicationId, input.operation, input.idempotencyKey)
  if (!row || row.status !== 'pending') return false
  finishAccountCommand(db, input)
  return true
}

export function eraseWorkspaceCommandHistoryInTx(
  db: Db,
  workspaceId: WorkspaceId,
  exceptCommandId?: CommandId,
): void {
  if (exceptCommandId === undefined) {
    db.prepare(`DELETE FROM account_commands WHERE workspaceId = ?`).run(workspaceId)
    return
  }
  db.prepare(`DELETE FROM account_commands WHERE workspaceId = ? AND commandId <> ?`)
    .run(workspaceId, exceptCommandId)
  db.prepare(`UPDATE account_commands SET workspaceId = NULL WHERE commandId = ? AND workspaceId = ?`)
    .run(exceptCommandId, workspaceId)
}

/** Erase command-ledger correlation for a local principal that is itself being erased. */
export function erasePrincipalCommandHistoryInTx(
  db: Db,
  principalId: PrincipalId,
  exceptCommandId?: CommandId,
): void {
  if (exceptCommandId) {
    db.prepare(`
      DELETE FROM account_commands
       WHERE (actorPrincipalId = ? OR targetPrincipalId = ?) AND commandId <> ?
    `).run(principalId, principalId, exceptCommandId)
    db.prepare(`
      UPDATE account_commands
         SET actorPrincipalId = CASE WHEN actorPrincipalId = ? THEN NULL ELSE actorPrincipalId END,
             targetPrincipalId = CASE WHEN targetPrincipalId = ? THEN NULL ELSE targetPrincipalId END
       WHERE commandId = ?
    `).run(principalId, principalId, exceptCommandId)
    return
  }
  db.prepare(`DELETE FROM account_commands WHERE actorPrincipalId = ? OR targetPrincipalId = ?`)
    .run(principalId, principalId)
}

/** Operator-only closure after the recorded repair target has been inspected and repaired. */
export function closeAccountCommandReconciliation(
  db: Db,
  applicationId: string,
  commandId: CommandId,
  referenceHash: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(referenceHash)) {
    throw new Error('The reconciliation reference must be supplied as a lowercase SHA-256 digest.')
  }
  const result = db.prepare(`
    UPDATE account_commands
       SET status = 'compensated',
           resultJson = json_object('kind', 'operator-closed', 'referenceHash', ?),
           updatedAt = ?
     WHERE applicationId = ? AND commandId = ? AND status = 'reconciliation_required'
  `).run(referenceHash, new Date().toISOString(), applicationId, commandId)
  return result.changes === 1
}

export function finishAccountCommand(
  db: Db,
  input: {
    applicationId: string
    operation: string
    idempotencyKey: IdempotencyKey
    status: Exclude<AccountCommandStatus, 'pending'>
    resultJson?: string | null
    failureCode?: AccountErrorCode | null
    now?: string
  },
): void {
  const result = db.prepare(`
    UPDATE account_commands
       SET status = ?, resultJson = ?, failureCode = ?, updatedAt = ?
     WHERE applicationId = ? AND operation = ? AND idempotencyKey = ? AND status = 'pending'
  `).run(
    input.status,
    input.resultJson ?? null,
    input.failureCode ?? null,
    input.now ?? new Date().toISOString(),
    input.applicationId,
    input.operation,
    input.idempotencyKey,
  )
  if (result.changes !== 1) {
    throw new Error('Account command could not transition from pending to a terminal state.')
  }
}
