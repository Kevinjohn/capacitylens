import type { HttpContext } from '@adonisjs/core/http'
import { parseBetaExport } from '@capacitylens/shared/data/betaTransfer'
import hash from '@adonisjs/core/services/hash'
import { consumeFailedSignInBudget, resetFailedSignInBudget } from '#services/auth/request_limit'
import {
  ACTION_PROOF_KINDS,
  actionProofActor,
  ActionProofError,
  createActionProof,
  type ActionProofKind,
} from '#services/auth/action_proof'
import { withActor } from '#services/auth/current_actor'

type ProofRequest = {
  action: ActionProofKind
  accountId: string
  intent: unknown
  password: string
}

function requestBody(value: unknown): ProofRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  const fields = ['action', 'accountId', 'intent', 'password']
  if (Object.keys(body).some((key) => !fields.includes(key))) return null
  if (!ACTION_PROOF_KINDS.includes(body.action as ActionProofKind)) return null
  if (typeof body.accountId !== 'string' || !body.accountId) return null
  if (typeof body.password !== 'string') return null
  if (!body.intent || typeof body.intent !== 'object' || Array.isArray(body.intent)) return null
  const intent = body.intent as Record<string, unknown>
  if (body.action === 'transfer-ownership') {
    if (Object.keys(intent).length !== 1 || typeof intent.toUserId !== 'string' || !intent.toUserId)
      return null
  } else if (body.action === 'import') {
    if (
      Object.keys(intent).length !== 2 ||
      !Number.isSafeInteger(intent.baseRevision) ||
      (intent.baseRevision as number) < 0
    )
      return null
    try {
      return {
        ...body,
        intent: {
          baseRevision: intent.baseRevision,
          document: parseBetaExport(JSON.stringify(intent.document)),
        },
      } as ProofRequest
    } catch {
      return null
    }
  } else if (Object.keys(intent).length !== 0) return null
  return body as ProofRequest
}

export default class ActionProofsController {
  async password(ctx: HttpContext) {
    const body = requestBody(ctx.request.body())
    if (!body) return ctx.response.badRequest({ error: 'Invalid action confirmation.' })
    if (!(await consumeFailedSignInBudget(ctx)))
      return ctx.response.tooManyRequests({ error: 'Rate limit exceeded.' })
    // Hash verification is slow and must stay outside the Kit transaction, which may be retried.
    const first = await withActor(ctx, async (actor, trx) => {
      await actionProofActor(body.accountId, trx)
      const row = await trx.from('users').where('id', actor.userId).select('password').first()
      return { sessionId: actor.sessionId, password: (row?.password as string | null) ?? null }
    })
    if (!first.password || !(await hash.verify(first.password, body.password)))
      return ctx.response.forbidden({ error: 'Incorrect password.', code: 'ACTION_PROOF_DENIED' })
    const proofId = await withActor(ctx, async (actor, trx) => {
      const current = await actionProofActor(body.accountId, trx)
      const row = await trx.from('users').where('id', actor.userId).select('password').first()
      if (current.sessionId !== first.sessionId || row?.password !== first.password)
        throw new ActionProofError()
      return createActionProof(trx, current, body.action, body.accountId, body.intent)
    })
    await resetFailedSignInBudget(ctx)
    return ctx.response.ok({ proofId })
  }
}
