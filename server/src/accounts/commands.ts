import { createHash } from 'node:crypto'
import { AccountContractError, type AccountErrorCode } from '@capacitylens/shared/account/errors'
import type { CommandIdentity, OperationReceipt, PrincipalId } from '@capacitylens/shared/account/types'
import type { Db } from '../db'
import {
  finishAccountCommand,
  getAccountCommand,
  reserveAccountCommand,
  type AccountCommandRecord,
} from './state'

const replayedCommandResults = new WeakSet<object>()

function compareCanonicalKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
  if (typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? 'null' : encoded
  }
  if (Array.isArray(value)) return `[${value.map((child) => canonicalJson(child)).join(',')}]`
  const toJSON = (value as { toJSON?: unknown }).toJSON
  if (typeof toJSON === 'function') return canonicalJson(toJSON.call(value))
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    // Command hashes cross browser/server/process boundaries. Locale-aware ordering can vary with
    // the host locale, so canonical JSON must use ECMAScript code-unit ordering only.
    .sort(([left], [right]) => compareCanonicalKeys(left, right))
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
}

/** Mark a successful result as an idempotent replay without leaking transport-only metadata into
 * the provider-neutral response shape. HTTP adapters use this to avoid logging a second mutation
 * audit event for a request that merely re-read an already committed result. */
export function markAccountCommandReplay<T>(result: T): T {
  if ((typeof result === 'object' && result !== null) || typeof result === 'function') {
    replayedCommandResults.add(result as object)
  }
  return result
}

export function wasAccountCommandReplayed(result: unknown): boolean {
  return ((typeof result === 'object' && result !== null) || typeof result === 'function') &&
    replayedCommandResults.has(result as object)
}

export function accountPayloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

export function secretDigest(purpose: string, secret: string): string {
  return createHash('sha256').update(`smallsass-account:${purpose}\0`).update(secret).digest('hex')
}

export interface CommandScope {
  applicationId: string
  operation: string
  actorPrincipalId: PrincipalId | null
  targetPrincipalId?: PrincipalId | null
  workspaceId?: string | null
}

export type BegunCommand<T> =
  | { kind: 'execute'; record: AccountCommandRecord }
  | { kind: 'replay'; record: AccountCommandRecord; result: T }

export function beginCommand<T>(
  db: Db,
  scope: CommandScope,
  command: CommandIdentity,
  canonicalPayload: unknown,
): BegunCommand<T> {
  const reserved = reserveAccountCommand(db, {
    applicationId: scope.applicationId,
    operation: scope.operation,
    idempotencyKey: command.idempotencyKey,
    commandId: command.commandId,
    actorPrincipalId: scope.actorPrincipalId,
    targetPrincipalId: scope.targetPrincipalId ?? null,
    workspaceId: scope.workspaceId ?? null,
    payloadHash: accountPayloadHash(canonicalPayload),
  })
  if (reserved.kind === 'conflict') {
    const commandIdReused = reserved.record.commandId === command.commandId &&
      (
        reserved.record.applicationId !== scope.applicationId ||
        reserved.record.operation !== scope.operation ||
        reserved.record.idempotencyKey !== command.idempotencyKey
      )
    throw new AccountContractError({
      code: 'IDEMPOTENCY_CONFLICT',
      message: commandIdReused
        ? 'That command id is already bound to another account operation.'
        : reserved.record.commandId !== command.commandId
          ? 'That idempotency key is already bound to another command id.'
        : 'That idempotency key was already used for a different command payload.',
      retryable: false,
      commandId: reserved.record.commandId,
    })
  }
  if (reserved.kind === 'reserved') return { kind: 'execute', record: reserved.record }
  if (reserved.record.status === 'completed' && reserved.record.resultJson !== null) {
    return {
      kind: 'replay',
      record: reserved.record,
      result: JSON.parse(reserved.record.resultJson) as T,
    }
  }
  throw new AccountContractError({
    code: reserved.record.status === 'reconciliation_required'
      ? 'DEPENDENCY_UNAVAILABLE'
      : reserved.record.status === 'pending'
        ? 'COMMAND_IN_PROGRESS'
        : 'CONFLICT',
    message: reserved.record.status === 'pending'
      ? 'That command is already in progress.'
      : 'That command already reached a terminal non-success state.',
    retryable: reserved.record.status === 'pending' || reserved.record.status === 'reconciliation_required',
    commandId: reserved.record.commandId,
  })
}

export function completeCommand(
  db: Db,
  scope: Pick<CommandScope, 'applicationId' | 'operation'>,
  command: CommandIdentity,
  result: unknown,
): void {
  finishAccountCommand(db, {
    applicationId: scope.applicationId,
    operation: scope.operation,
    idempotencyKey: command.idempotencyKey,
    status: 'completed',
    resultJson: canonicalJson(result),
  })
}

export function terminateCommand(
  db: Db,
  scope: Pick<CommandScope, 'applicationId' | 'operation'>,
  command: CommandIdentity,
  status: 'compensated' | 'reconciliation_required',
  failureCode: AccountErrorCode,
  result?: unknown,
): void {
  finishAccountCommand(db, {
    applicationId: scope.applicationId,
    operation: scope.operation,
    idempotencyKey: command.idempotencyKey,
    status,
    failureCode,
    resultJson: result === undefined ? null : canonicalJson(result),
  })
}

export function operationReceipt(record: AccountCommandRecord): OperationReceipt {
  return { commandId: record.commandId, completedAt: record.updatedAt }
}

export function readCommand(
  db: Db,
  applicationId: string,
  operation: string,
  command: CommandIdentity,
): AccountCommandRecord | null {
  return getAccountCommand(db, applicationId, operation, command.idempotencyKey)
}
