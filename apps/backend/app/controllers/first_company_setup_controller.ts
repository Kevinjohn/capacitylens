import type { HttpContext } from '@adonisjs/core/http'
import { withActor } from '#services/auth/current_actor'
import { requiresFirstCompanySetup } from '#services/first_company_setup'
import { createInitialCompany } from '#services/initial_company_defaults'
import { MAX_NAME_LENGTH, parseUserName } from '@capacitylens/shared/lib/strings'

/**
 * Establishes company access only for the sole confirmed, admitted principal on an empty
 * installation. The Kit's account lock and the installation lock row serialise competing setups.
 */
export default class FirstCompanySetupController {
  async store(ctx: HttpContext) {
    const body: unknown = ctx.request.body()
    // The same name rule as every later company-settings write, so the stored name can be re-saved.
    const name =
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).every((key) => ['name', 'weekStartsOn', 'timeZone'].includes(key))
        ? parseUserName((body as { name?: unknown }).name)
        : null
    const calendar = body as { weekStartsOn?: unknown; timeZone?: unknown }
    // New calendar fields are additive: existing name-only callers keep the browser defaults.
    // Supplied null or invalid values still fail validation rather than being defaulted.
    const weekStartsOn =
      calendar && Object.hasOwn(calendar, 'weekStartsOn') ? calendar.weekStartsOn : 1
    const timeZone = calendar && Object.hasOwn(calendar, 'timeZone') ? calendar.timeZone : 'Etc/GMT'
    let validTimeZone = false
    if (typeof timeZone === 'string' && timeZone.length <= 128 && !/^[+-]/.test(timeZone)) {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone })
        validTimeZone = true
      } catch {
        // The supplied zone must be supported without falling back to the server's zone.
      }
    }
    if (name === null || ![0, 1].includes(weekStartsOn as number) || !validTimeZone)
      return ctx.response.badRequest({
        error: `Enter a company name of up to ${MAX_NAME_LENGTH} characters without unsupported characters, a Sunday or Monday week start, and a supported time zone.`,
        code: 'INVALID_INPUT',
      })
    const result = await withActor(ctx, async (actor, trx) => {
      await trx.from('account_transaction_lock').where('id', 1).increment('version', 1)
      if (!(await requiresFirstCompanySetup(actor.userId, trx))) return null
      return createInitialCompany(trx, {
        name,
        ownerId: actor.userId,
        actorId: actor.userId,
        weekStartsOn: weekStartsOn as 0 | 1,
        timezone: timeZone as string,
      })
    })
    if (!result)
      return ctx.response.conflict({
        error: 'First company setup is unavailable for this installation.',
        code: 'COMPANY_SETUP_UNAVAILABLE',
      })
    return ctx.response.created({ accountId: result.accountId })
  }
}
