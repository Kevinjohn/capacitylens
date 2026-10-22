import type { HttpContext } from '@adonisjs/core/http'
import { withTransaction } from '#services/with_transaction'
import { applyLifecycle } from '#services/lifecycle'
import { BatchRequestError } from '#services/planning_operations/errors'
import { LifecycleTransitionError } from '@capacitylens/shared/domain/lifecycle'
import { dataContextForActor } from '#services/planning_operations/data_policy'
import { lifecycleValidator } from '#validators/lifecycle'
import { assertCompanyAction } from '#services/auth/authorization'

export default class LifecycleController {
  async mutate(ctx: HttpContext) {
    const { params, request, response, logger } = ctx
    try {
      const action = params.action
      if (
        action !== 'archive' &&
        action !== 'unarchive' &&
        action !== 'delete' &&
        action !== 'purge'
      )
        throw new BatchRequestError('Not found.', 404)
      const body = await request.validateUsing(lifecycleValidator, {
        data: request.body(),
      })
      let auditWarning = false
      const result = await withTransaction(async (trx) => {
        if (action === 'purge') await assertCompanyAction(ctx, body.accountId, 'purge', trx, true)
        const context = await dataContextForActor(ctx, trx, (event) => {
          try {
            logger.info({
              event: 'capacitylens.lifecycle.committed',
              action,
              entity: params.entity,
              entityId: params.id,
              accountId: body.accountId,
              ...event,
            })
          } catch {
            auditWarning = true
          }
        })
        return applyLifecycle(trx, params.entity, params.id, body.accountId, action, context)
      })
      if (auditWarning) response.header('x-capacitylens-audit-warning', 'true')
      return action === 'purge' ? response.noContent() : response.ok(result)
    } catch (error) {
      if (error instanceof BatchRequestError)
        return response
          .status(error.status)
          .send({ ...(error.code ? { code: error.code } : {}), error: error.message })
      if (error instanceof LifecycleTransitionError)
        return response.conflict({ code: error.code, error: error.message })
      throw error
    }
  }
}
