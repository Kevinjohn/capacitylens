import type { HttpContext } from '@adonisjs/core/http'
import { resolveCurrentActor } from '#services/auth/session_authority'
import { withTransaction } from '#services/with_transaction'
import { requiresFirstCompanySetup } from '#services/first_company_setup'
import { createInitialCompany } from '#services/initial_company_defaults'

/** Establishes company access only for the sole signed-in principal on an empty installation. */
export default class FirstCompanySetupController {
  async store(ctx: HttpContext) {
    const body: unknown = ctx.request.body()
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('name' in body) ||
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.trim().length > 200
    )
      return ctx.response.badRequest({
        error: 'Enter a company name of up to 200 characters.',
        code: 'INVALID_INPUT',
      })
    const name = body.name.trim()
    const result = await withTransaction(async (trx) => {
      await trx.from('account_transaction_lock').where('id', 1).increment('version', 1)
      const actor = await resolveCurrentActor(ctx, trx)
      if (!(await requiresFirstCompanySetup(actor.userId, trx))) return null
      return createInitialCompany(trx, { name, ownerId: actor.userId, actorId: actor.userId })
    })
    if (!result)
      return ctx.response.conflict({
        error: 'First company setup is unavailable for this installation.',
        code: 'COMPANY_SETUP_UNAVAILABLE',
      })
    return ctx.response.created({ accountId: result.accountId })
  }
}
