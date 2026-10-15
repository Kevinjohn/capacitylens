import { createHash, randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  isAccountCommandId,
  isAccountIdempotencyKey,
} from '@capacitylens/shared/account/validation'

export interface AccountCommandIdentity {
  commandId: string
  idempotencyKey: string
}

export class AccountCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message)
  }
}

function canonical(value: unknown): string {
  if (value === undefined)
    throw new AccountCommandError('Invalid command payload.', 400, 'VALIDATION_FAILED')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`
}

/** Parses the existing paired account-command headers, minting both for older callers. */
export function readAccountCommand(ctx: HttpContext): AccountCommandIdentity {
  const commandId = ctx.request.header('x-account-command-id')
  const idempotencyKey = ctx.request.header('idempotency-key')
  if (commandId === undefined && idempotencyKey === undefined)
    return { commandId: randomUUID(), idempotencyKey: randomUUID() }
  if (!isAccountCommandId(commandId) || !isAccountIdempotencyKey(idempotencyKey))
    throw new AccountCommandError('Invalid or unpaired command headers.', 400, 'VALIDATION_FAILED')
  return { commandId, idempotencyKey }
}

interface ClaimInput {
  actorId: string
  operation: string
  accountId: string
  payload: unknown
  command: AccountCommandIdentity
  kind: 'semantic' | 'secret'
  receiptSurvivesAccountDeletion?: boolean
}

function conflict(): never {
  throw new AccountCommandError('Command identity already used.', 409, 'IDEMPOTENCY_CONFLICT')
}

function claimKey(input: ClaimInput) {
  return {
    operation: `${input.kind}:${input.operation}:actor:${input.actorId}`,
    payloadHash: createHash('sha256')
      .update(canonical({ accountId: input.accountId, payload: input.payload }))
      .digest('hex'),
  }
}

async function existingClaim(connection: TransactionClientContract, input: ClaimInput) {
  const { operation, payloadHash } = claimKey(input)
  const row = await connection
    .from('command_results')
    .where((query) => {
      query
        .where('command_id', input.command.commandId)
        .orWhere({ operation, idempotency_key: input.command.idempotencyKey })
    })
    .first()
  if (!row) return null
  const result: unknown = typeof row.result === 'string' ? JSON.parse(row.result) : row.result
  if (
    input.kind === 'secret' ||
    row.command_id !== input.command.commandId ||
    row.idempotency_key !== input.command.idempotencyKey ||
    row.operation !== operation ||
    row.payload_hash !== payloadHash ||
    result === null
  )
    conflict()
  return { replayed: true as const, result }
}

/** Reads only a committed semantic receipt using the same actor, alias, and payload checks as a claim. */
export async function readCompletedAccountCommand(
  trx: TransactionClientContract,
  input: ClaimInput
) {
  return existingClaim(trx, input)
}

/** Claims one product command inside the caller's authorized transaction. */
export async function claimAccountCommand(trx: TransactionClientContract, input: ClaimInput) {
  const existing = await existingClaim(trx, input)
  if (existing) return existing
  const { operation, payloadHash } = claimKey(input)
  const now = new Date().toISOString()
  await trx.table('command_results').insert({
    id: randomUUID(),
    account_id: input.receiptSurvivesAccountDeletion ? null : input.accountId,
    command_id: input.command.commandId,
    idempotency_key: input.command.idempotencyKey,
    operation,
    payload_hash: payloadHash,
    result: JSON.stringify(null),
    created_at: now,
    updated_at: now,
  })
  return { replayed: false as const }
}

/** Saves a non-secret semantic result before the caller commits its mutation. */
export async function completeAccountCommand(
  trx: TransactionClientContract,
  commandId: string,
  result: unknown
) {
  if (result === undefined) throw new Error('A command result is required.')
  const serialized = JSON.stringify(result)
  await trx
    .from('command_results')
    .where('command_id', commandId)
    .update({ result: serialized, updated_at: new Date().toISOString() })
  const row = await trx
    .from('command_results')
    .where('command_id', commandId)
    .select('result')
    .first()
  if (
    !row ||
    (typeof row.result === 'string' ? row.result : JSON.stringify(row.result)) !== serialized
  )
    throw new Error('Command claim was not completed.')
}
