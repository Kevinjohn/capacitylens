import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { parseData } from '@capacitylens/shared/data/transfer'
import { commitAccountImport, prepareAccountImport } from '#services/import_account'
import { withTransaction } from '#services/with_transaction'
import { BatchRequestError } from '#services/batch/errors'
import { resolveCurrentActor, assertFreshSession } from '#services/auth/session_authority'
import { activeCompanyRole } from '#services/auth/authorization'

const requestValidator = vine.compile(
  vine.object({ accountId: vine.string().trim().minLength(1), data: vine.any() })
)

export default class ImportsController {
  async store(ctx: HttpContext) {
    const { request, response, logger } = ctx
    const payload = await request.validateUsing(requestValidator, { data: request.body() })
    let incoming
    try {
      incoming = parseData(JSON.stringify(payload.data ?? {}))
    } catch (error) {
      logger.warn({ err: error }, 'Import data rejected')
      return response.badRequest({ error: 'The import data is not valid CapacityLens data.' })
    }
    try {
      const prepared = await prepareAccountImport(payload.accountId, incoming)
      const result = await withTransaction(async (trx) => {
        const actor = await resolveCurrentActor(ctx, trx)
        const role = await activeCompanyRole(actor.userId, payload.accountId, trx)
        if (role !== 'owner') throw new BatchRequestError('Forbidden.', 403)
        assertFreshSession(actor)
        return commitAccountImport(trx, prepared, actor.userId)
      })
      let auditWarning = false
      try {
        logger.info({
          event: 'capacitylens.import.committed',
          accountId: payload.accountId,
          ...result,
        })
      } catch {
        auditWarning = true
        response.header('x-capacitylens-audit-warning', 'true')
      }
      return response.ok({ ...result, auditWarning })
    } catch (error) {
      if (error instanceof BatchRequestError)
        return response.status(error.status).send({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.current ?? {}),
        })
      throw error
    }
  }
}
