import { createHash, randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { activeCompanyRole } from './authorization.js'
import { activeMasquerade } from './masquerade.js'
import { resolveCurrentActor, type CurrentActor } from './session_authority.js'
import { affectedRows } from '#services/admission/affected_rows'

export type ActionProofKind = 'transfer-ownership' | 'import' | 'anonymise'

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

/** Resolves live Owner authority for a proof request or spend. */
export async function actionProofActor(
  ctx: HttpContext,
  accountId: string,
  trx: TransactionClientContract
): Promise<CurrentActor> {
  const actor = await resolveCurrentActor(ctx, trx)
  if (await activeMasquerade(actor.sessionId, trx)) throw new ActionProofError()
  if ((await activeCompanyRole(actor.userId, accountId, trx)) !== 'owner')
    throw new ActionProofError()
  return actor
}

/** Creates one proof; provider starts leave it unverified until the checked callback. */
export async function createActionProof(
  trx: TransactionClientContract,
  actor: CurrentActor,
  action: ActionProofKind,
  accountId: string,
  intent: unknown,
  verified: boolean
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
    verified_at: verified ? new Date(now).toISOString() : null,
    consumed_at: null,
  })
  return id
}

/** Provider callback proves the pending row only for its original principal and native session. */
export async function verifyActionProof(
  trx: TransactionClientContract,
  id: string,
  actor: CurrentActor
) {
  const updated = await trx
    .from('action_proofs')
    .where({ id, user_id: actor.userId, session_id: actor.sessionId })
    .whereNull('verified_at')
    .whereNull('consumed_at')
    .where('expires_at', '>', new Date().toISOString())
    .update({ verified_at: new Date().toISOString() })
  if (affectedRows(updated) !== 1) throw new ActionProofError()
}

/** The conditional spend and product mutation share one transaction and rollback boundary. */
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
    .whereExists((query) =>
      query.from('user_session_index').where({ user_id: actor.userId, session_id: actor.sessionId })
    )
    .update({ consumed_at: new Date().toISOString() })
  if (affectedRows(updated) !== 1) throw new ActionProofError()
}
