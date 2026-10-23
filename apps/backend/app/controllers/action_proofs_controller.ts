import type { HttpContext } from '@adonisjs/core/http'
import { parseBetaExport } from '@capacitylens/shared/data/betaTransfer'
import { withTransaction } from '#services/with_transaction'
import { consumeFailedSignInBudget, resetFailedSignInBudget } from '#services/auth/request_limit'
import { verifyPassword, PasswordProcessingUnavailableError } from '#services/password_service'
import {
  actionProofActor,
  ActionProofError,
  createActionProof,
  type ActionProofKind,
} from '#services/auth/action_proof'
import { resolveCurrentActor, SessionAuthorityError } from '#services/auth/session_authority'

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
  if (!['transfer-ownership', 'import', 'anonymise'].includes(String(body.action))) return null
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

function failure(ctx: HttpContext, error: unknown) {
  if (error instanceof ActionProofError || error instanceof SessionAuthorityError)
    return ctx.response.status(error.status).send({ error: error.message, code: error.code })
  if (error instanceof PasswordProcessingUnavailableError)
    return ctx.response.serviceUnavailable({ error: error.message, code: error.code })
  throw error
}

export default class ActionProofsController {
  async password(ctx: HttpContext) {
    const body = requestBody(ctx.request.body())
    if (!body) return ctx.response.badRequest({ error: 'Invalid action confirmation.' })
    try {
      if (!(await consumeFailedSignInBudget(ctx)))
        return ctx.response.tooManyRequests({ error: 'Rate limit exceeded.' })
      const actor = await resolveCurrentActor(ctx)
      await withTransaction((trx) => actionProofActor(ctx, body.accountId, trx))
      const hash = actor.user.passwordHash
      if (!hash || !(await verifyPassword(hash, body.password)))
        return ctx.response.forbidden({ error: 'Incorrect password.', code: 'ACTION_PROOF_DENIED' })
      const proofId = await withTransaction(async (trx) => {
        const current = await actionProofActor(ctx, body.accountId, trx)
        const credential = await trx
          .from('users')
          .where('id', current.userId)
          .select('password_hash')
          .first()
        if (
          current.userId !== actor.userId ||
          current.sessionId !== actor.sessionId ||
          credential?.password_hash !== hash
        )
          throw new ActionProofError()
        return createActionProof(trx, current, body.action, body.accountId, body.intent, true)
      })
      await resetFailedSignInBudget(ctx)
      return ctx.response.ok({ proofId })
    } catch (error) {
      return failure(ctx, error)
    }
  }
}
