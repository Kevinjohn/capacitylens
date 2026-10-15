import type { HttpContext } from '@adonisjs/core/http'
import { readState, readStateWithClient } from '#services/state_repository'
import { transformState } from '#transformers/state_transformer'
import { authMode } from '#services/auth/mode'
import { resolveCurrentActor } from '#services/auth/session_authority'
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization'
import { withTransaction } from '#services/with_transaction'
import { APP_DATA_KEYS, emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

export default class ExportsController {
  async show(ctx: HttpContext) {
    const { request, response } = ctx
    const accountId = request.qs().accountId
    const includeInactive = request.qs().includeInactive
    if (accountId !== undefined && (typeof accountId !== 'string' || !accountId.trim()))
      return response.badRequest({ error: 'accountId must be a non-empty string.' })
    if (includeInactive !== undefined && includeInactive !== '1')
      return response.badRequest({
        error: 'includeInactive must be the literal value 1 when present.',
      })
    if (authMode() === 'off') {
      const state = await readState(accountId, accountId === undefined || includeInactive === '1')
      return response.ok(transformState(state, accountId, 'owner'))
    }
    return withTransaction(async (trx) => {
      const actor = await resolveCurrentActor(ctx, trx)
      const memberships = accountId
        ? [{ account_id: accountId, role: await activeCompanyRole(actor.userId, accountId, trx) }]
        : await trx
            .from('memberships')
            .where({ user_id: actor.userId, status: 'active' })
            .select('account_id', 'role')
      const combined = emptyAppData()
      for (const membership of memberships) {
        const id = String(membership.account_id)
        const role = await activeCompanyRole(actor.userId, id, trx)
        if (!role) {
          if (accountId) throw new IdentityAuthorityError('Forbidden.')
          continue
        }
        const state = await readStateWithClient(
          trx,
          id,
          accountId === undefined || includeInactive === '1'
        )
        const slice = transformState(state, id, role)
        for (const key of APP_DATA_KEYS) combined[key].push(...(slice[key] as never[]))
      }
      return response.ok(combined as AppData)
    })
  }
}
