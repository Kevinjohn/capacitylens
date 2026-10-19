import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { rejectUnknownFields } from '#validators/rules/unknown_fields'
import { parseData } from '@capacitylens/shared/data/transfer'
import { commitAccountImport, prepareAccountImport } from '#services/import_account'
import { withTransaction } from '#services/with_transaction'
import { BatchRequestError } from '#services/batch/errors'

const requestValidator = vine.compile(
  vine
    .object({ accountId: vine.string().trim().minLength(1), data: vine.any() })
    .use(rejectUnknownFields(['accountId', 'data']))
)

export default class ImportsController {
  async store({ request, response, auth, logger }: HttpContext) {
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
      const result = await withTransaction((trx) =>
        commitAccountImport(trx, prepared, auth.use('trustedLocal').getUserOrFail().id)
      )
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
