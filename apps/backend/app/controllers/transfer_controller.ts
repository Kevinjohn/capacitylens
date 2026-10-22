import type { HttpContext } from '@adonisjs/core/http'
import {
  parseBetaExport,
  BetaTransferError,
  type BetaExportDocument,
} from '@capacitylens/shared/data/betaTransfer'
import { withTransaction } from '#services/with_transaction'
import { actionProofActor, ActionProofError, consumeActionProof } from '#services/auth/action_proof'
import { BatchRequestError } from '#services/planning_operations/errors'
import {
  applyBetaAccountTransfer,
  previewBetaAccountTransfer,
} from '#services/beta_account_transfer'
import { resolveCurrentActor, SessionAuthorityError } from '#services/auth/session_authority'

function input(value: unknown, apply: boolean) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  const expected = apply ? ['accountId', 'document', 'baseRevision'] : ['accountId', 'document']
  if (
    expected.some((key) => !Object.hasOwn(body, key)) ||
    Object.keys(body).some((key) => !expected.includes(key) && !(apply && key === 'proofId'))
  )
    return null
  if (typeof body.accountId !== 'string' || !body.accountId) return null
  if (
    apply &&
    (!Number.isSafeInteger(body.baseRevision) ||
      (body.baseRevision as number) < 0 ||
      (body.proofId !== undefined && typeof body.proofId !== 'string'))
  )
    return null
  try {
    return {
      accountId: body.accountId as string,
      document: parseBetaExport(JSON.stringify(body.document)) as BetaExportDocument,
      baseRevision: apply ? (body.baseRevision as number) : undefined,
      proofId: apply ? ((body.proofId as string | undefined) ?? '') : undefined,
    }
  } catch {
    return null
  }
}

function failure(ctx: HttpContext, error: unknown) {
  if (error instanceof ActionProofError || error instanceof SessionAuthorityError)
    return ctx.response.status(error.status).send({ error: error.message, code: error.code })
  if (error instanceof BatchRequestError)
    return ctx.response.status(error.status).send({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.current ?? {}),
    })
  if (error instanceof BetaTransferError) return ctx.response.badRequest({ error: error.message })
  throw error
}

export default class TransferController {
  async preview(ctx: HttpContext) {
    const body = input(ctx.request.body(), false)
    if (!body) return ctx.response.badRequest({ error: 'Invalid beta transfer document.' })
    try {
      await resolveCurrentActor(ctx)
      const result = await withTransaction(async (trx) => {
        await actionProofActor(ctx, body.accountId as string, trx)
        return previewBetaAccountTransfer(trx, body.accountId as string, body.document)
      })
      return ctx.response.ok(result)
    } catch (error) {
      return failure(ctx, error)
    }
  }

  async apply(ctx: HttpContext) {
    const body = input(ctx.request.body(), true)
    if (!body) return ctx.response.badRequest({ error: 'Invalid beta transfer request.' })
    try {
      await resolveCurrentActor(ctx)
      const result = await withTransaction(async (trx) => {
        const actor = await actionProofActor(ctx, body.accountId as string, trx)
        await consumeActionProof(
          trx,
          actor,
          body.proofId as string,
          'import',
          body.accountId as string,
          {
            baseRevision: body.baseRevision,
            document: body.document,
          }
        )
        return applyBetaAccountTransfer(
          trx,
          body.accountId as string,
          body.document,
          body.baseRevision as number,
          actor.userId
        )
      })
      return ctx.response.ok(result)
    } catch (error) {
      return failure(ctx, error)
    }
  }
}
