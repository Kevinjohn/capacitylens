import type { HttpContext } from '@adonisjs/core/http'
import { withTransaction } from '#services/with_transaction'
import { applyLifecycle } from '#services/lifecycle'
import { BatchRequestError } from '#services/batch/errors'
import { LifecycleTransitionError } from '@capacitylens/shared/domain/lifecycle'
import { trustedLocalDataContext } from '#services/batch/data_policy'
import env from '#start/env'
import { lifecycleValidator } from '#validators/lifecycle'

export default class LifecycleController {
  async mutate({ params, request, response, auth, logger }: HttpContext) {
    try {
      const body = await request.validateUsing(lifecycleValidator, {
        data: request.body(),
      })
      const action = params.action
      if (
        action !== 'archive' &&
        action !== 'unarchive' &&
        action !== 'delete' &&
        action !== 'purge'
      )
        throw new BatchRequestError('Not found.', 404)
      let auditWarning = false
      const context = trustedLocalDataContext(
        auth.use('trustedLocal').getUserOrFail().id,
        env.get('CAPACITYLENS_MULTI_ACCOUNT') === true,
        (event) => {
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
        }
      )
      const result = await withTransaction((trx) =>
        applyLifecycle(trx, params.entity, params.id, body.accountId, action, context)
      )
      if (auditWarning) response.header('x-capacitylens-audit-warning', 'true')
      return action === 'purge' ? response.noContent() : response.ok(result)
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'E_VALIDATION_ERROR'
      ) {
        const messages =
          'messages' in error && Array.isArray(error.messages) ? error.messages : undefined
        const first = messages?.[0]
        if (
          typeof first === 'object' &&
          first !== null &&
          'rule' in first &&
          first.rule === 'unknownFields'
        )
          throw error
        return response.badRequest({ error: 'accountId is required.' })
      }
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
