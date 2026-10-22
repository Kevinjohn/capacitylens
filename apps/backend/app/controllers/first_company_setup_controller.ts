import type { HttpContext } from '@adonisjs/core/http'
import { resolveCurrentActor } from '#services/auth/session_authority'
import { withTransaction } from '#services/with_transaction'
import { requiresFirstCompanySetup } from '#services/first_company_setup'
import { createInitialCompany } from '#services/initial_company_defaults'
import { MAX_NAME_LENGTH, parseUserName } from '@capacitylens/shared/lib/strings'

/** Establishes company access only for the sole signed-in principal on an empty installation. */
export default class FirstCompanySetupController {
  async store(ctx: HttpContext) {
    const body: unknown = ctx.request.body()
    // The same name rule as every later company-settings write, so the stored name can be re-saved.
    const name =
      body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1
        ? parseUserName((body as { name?: unknown }).name)
        : null
    if (name === null)
      return ctx.response.badRequest({
        error: `Enter a company name of up to ${MAX_NAME_LENGTH} characters without symbols.`,
        code: 'INVALID_INPUT',
      })
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
