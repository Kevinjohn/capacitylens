import type { HttpContext } from '@adonisjs/core/http'
import { readState, readStateWithClient } from '#services/state_repository'
import { transformState } from '#transformers/state_transformer'
import { authMode } from '#services/auth/mode'
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization'
import { effectiveReadPrincipal } from '#services/auth/masquerade'
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
      const principal = await effectiveReadPrincipal(ctx, trx)
      if (principal.accountId && accountId && principal.accountId !== accountId)
        throw new IdentityAuthorityError('Forbidden.')
      const memberships = accountId
        ? [
            {
              account_id: accountId,
              role: await activeCompanyRole(principal.effectiveId, accountId, trx),
            },
          ]
        : await trx
            .from('memberships')
            .where({ user_id: principal.effectiveId, status: 'active' })
            .select('account_id', 'role')
      const combined = emptyAppData()
      for (const membership of memberships) {
        const id = String(membership.account_id)
        if (principal.accountId && principal.accountId !== id) continue
        const role = await activeCompanyRole(principal.effectiveId, id, trx)
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
