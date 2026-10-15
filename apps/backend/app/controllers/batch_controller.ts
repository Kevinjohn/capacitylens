import type { HttpContext } from '@adonisjs/core/http'
import { isBrowserSyncSessionId } from '@capacitylens/shared/account/validation'
import { batchValidator } from '#validators/batch'
import { applyBatch } from '#services/batch/service'
import { BatchRequestError } from '#services/batch/errors'
import { isTable } from '#services/batch/entity_policy'
import type { BatchOp, SyncOrder } from '#services/batch/types'
import { withTransaction } from '#services/with_transaction'
import env from '#start/env'
import { dataContextForActor } from '#services/batch/data_policy'

function parseSyncOrder(request: HttpContext['request']): SyncOrder | null {
  const sessionId = request.header('x-capacitylens-sync-session')
  const rawSequence = request.header('x-capacitylens-sync-sequence')
  if (sessionId === undefined && rawSequence === undefined) return null
  const sequence =
    typeof rawSequence === 'string' && /^[1-9]\d{0,15}$/.test(rawSequence)
      ? Number(rawSequence)
      : Number.NaN
  if (!isBrowserSyncSessionId(sessionId) || !Number.isSafeInteger(sequence))
    throw new BatchRequestError('Invalid browser sync ordering headers.')
  return { sessionId, sequence }
}

export default class BatchController {
  async store(ctx: HttpContext) {
    const { request, response, logger } = ctx
    try {
      const syncOrder = parseSyncOrder(request)
      const payload = await request.validateUsing(batchValidator, { data: request.body() })
      const ops = payload.ops as unknown as BatchOp[]
      for (const op of ops) {
        if (!isTable(op.table))
          throw new BatchRequestError('Each op needs a known table and string id.')
        if (
          syncOrder &&
          typeof (op.method === 'PUT' ? op.row.updatedAt : op.updatedAt) !== 'string'
        )
          throw new BatchRequestError(
            `An ordered ${op.method} op needs a string updatedAt revision.`
          )
      }
      const result = await withTransaction(async (trx) => {
        const context = await dataContextForActor(
          ctx,
          trx,
          env.get('CAPACITYLENS_MULTI_ACCOUNT') === true,
          (event) => logger.info({ event: 'capacitylens.batch.committed', ...event })
        )
        return applyBatch(trx, ops, syncOrder, context)
      })
      if (result.auditWarning) response.header('x-capacitylens-audit-warning', 'true')
      return response.ok(result)
    } catch (error) {
      if (error instanceof BatchRequestError)
        return response.status(error.status).send({
          ...(error.code ? { code: error.code } : {}),
          error: error.message,
          ...(error.current ? { current: error.current } : {}),
        })
      throw error
    }
  }
}
