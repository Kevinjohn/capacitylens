import { createHash, randomUUID } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { activeCompanyRole } from './authorization.js'
import { actorIn, type CurrentActor } from './current_actor.js'
import { affectedRows } from '#services/admission/affected_rows'

export const ACTION_PROOF_KINDS = ['transfer-ownership', 'import', 'anonymise'] as const
export type ActionProofKind = (typeof ACTION_PROOF_KINDS)[number]

export class ActionProofError extends Error {
  readonly status = 403
  readonly code = 'ACTION_PROOF_REQUIRED'
  constructor(message = 'Confirm this action again.') {
    super(message)
  }
}

const PROOF_MS = 5 * 60_000

function canonical(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(',')}}`
}

/** Binds the exact operation contents without storing a sensitive import document. */
export function actionIntentHash(action: ActionProofKind, accountId: string, intent: unknown) {
  return createHash('sha256').update(canonical({ action, accountId, intent })).digest('hex')
}

/** Resolves live Owner authority for a proof request or spend inside `withActor`. */
export async function actionProofActor(
  accountId: string,
  trx: TransactionClientContract
): Promise<CurrentActor> {
  const actor = actorIn(trx)
  if (actor.masqueradeContext?.isMasquerading) throw new ActionProofError()
  if ((await activeCompanyRole(actor.userId, accountId, trx)) !== 'owner')
    throw new ActionProofError()
  return actor
}

/** Creates one verified proof bound to the actor's sign-in, company and exact operation. */
export async function createActionProof(
  trx: TransactionClientContract,
  actor: CurrentActor,
  action: ActionProofKind,
  accountId: string,
  intent: unknown
) {
  const id = randomUUID()
  const now = Date.now()
  await trx.from('action_proofs').where('expires_at', '<=', new Date(now).toISOString()).delete()
  await trx.from('action_proofs').whereNotNull('consumed_at').delete()
  await trx.table('action_proofs').insert({
    id,
    user_id: actor.userId,
    session_id: actor.sessionId,
    account_id: accountId,
    action,
    intent_hash: actionIntentHash(action, accountId, intent),
    expires_at: new Date(now + PROOF_MS).toISOString(),
    verified_at: new Date(now).toISOString(),
    consumed_at: null,
  })
  return id
}

/**
 * The conditional spend and product mutation share one transaction and rollback boundary. The
 * sign-in row is locked by `withActor`; a proof whose sign-in ended was removed with it.
 */
export async function consumeActionProof(
  trx: TransactionClientContract,
  actor: CurrentActor,
  proofId: string,
  action: ActionProofKind,
  accountId: string,
  intent: unknown
) {
  const updated = await trx
    .from('action_proofs')
    .where({
      id: proofId,
      user_id: actor.userId,
      session_id: actor.sessionId,
      account_id: accountId,
      action,
      intent_hash: actionIntentHash(action, accountId, intent),
    })
    .whereNotNull('verified_at')
    .whereNull('consumed_at')
    .where('expires_at', '>', new Date().toISOString())
    .update({ consumed_at: new Date().toISOString() })
  if (affectedRows(updated) !== 1) throw new ActionProofError()
}
