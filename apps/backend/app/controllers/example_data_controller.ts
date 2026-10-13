import type { HttpContext } from '@adonisjs/core/http'
import { buildExampleCompany, countExampleRows } from '@capacitylens/shared/data/exampleCompany'
import { todayISO } from '@capacitylens/shared/lib/dateMath'
import { encodeRow, readStateWithClient } from '#services/state_repository'
import { TABLE_NAMES } from '#services/batch/entity_policy'
import { withTransaction } from '#services/with_transaction'
import { writeAudit } from '#services/audit'
import { BatchRequestError } from '#services/batch/errors'

const INSERT_ORDER = [
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'timeOff',
] as const

export default class ExampleDataController {
  async store({ params, response, auth, logger }: HttpContext) {
    const accountId = params.accountId
    try {
      const added = await withTransaction(async (trx) => {
        const state = await readStateWithClient(trx, accountId, true)
        const account = state.accounts[0]
        if (!account) throw new BatchRequestError('Company not found.', 404)
        if (
          state.resources.length > 0 ||
          state.clients.some((client) => client.builtin !== true) ||
          state.projects.length > 0 ||
          state.allocations.length > 0
        )
          throw new BatchRequestError(
            'Example data can only be added to a company that has no people, clients, projects or allocations, including archived or deleted ones.',
            409,
            undefined,
            'EXAMPLE_DATA_COMPANY_NOT_EMPTY'
          )
        const sample = buildExampleCompany({
          accountId,
          referenceDate: todayISO(account.timezone ?? undefined),
          weekStartsOn: account.weekStartsOn ?? 1,
        })
        for (const key of INSERT_ORDER) {
          const rows = sample[key]
          if (rows.length > 0)
            await trx
              .table(TABLE_NAMES[key])
              .multiInsert(
                rows.map((row) =>
                  encodeRow(TABLE_NAMES[key], row as unknown as Record<string, unknown>)
                )
              )
        }
        await writeAudit(trx, {
          accountId,
          actorId: auth.use('trustedLocal').getUserOrFail().id,
          action: 'exampleData',
          entity: 'account',
          entityId: accountId,
          fields: Object.keys(sample),
        })
        return countExampleRows(sample)
      })
      try {
        logger.info({ accountId, added }, 'Example data committed')
      } catch {
        response.header('x-capacitylens-audit-warning', 'true')
      }
      return response.created({ added })
    } catch (error) {
      if (error instanceof BatchRequestError)
        return response.status(error.status).send({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        })
      throw error
    }
  }
}
