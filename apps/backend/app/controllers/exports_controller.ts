import type { HttpContext } from '@adonisjs/core/http'
import { readState } from '#services/state_repository'
import { transformState } from '#transformers/state_transformer'

export default class ExportsController {
  async show({ request, response }: HttpContext) {
    const accountId = request.qs().accountId
    const includeInactive = request.qs().includeInactive
    if (accountId !== undefined && (typeof accountId !== 'string' || !accountId.trim()))
      return response.badRequest({ error: 'accountId must be a non-empty string.' })
    if (includeInactive !== undefined && includeInactive !== '1')
      return response.badRequest({
        error: 'includeInactive must be the literal value 1 when present.',
      })
    const state = await readState(accountId, accountId === undefined || includeInactive === '1')
    return response.ok(transformState(state, accountId, 'owner'))
  }
}
