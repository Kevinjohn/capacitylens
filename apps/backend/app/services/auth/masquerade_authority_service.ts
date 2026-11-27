import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import { accountKitAuthority } from '@kevinjohn/adonisjs-masquerade/account-kit'
import type { MasqueradePolicy } from '@kevinjohn/adonisjs-masquerade/types'
import { managedGuard } from '#services/auth/managed_guard'
import { sessionUsers } from '#config/auth'
import { AuthorizationService } from '#services/auth/authorization_service'
import { canMasqueradeAs } from '@capacitylens/shared/domain/access'
import type User from '#models/user'

type MasqueradeUser = User

/** The package checks Account Kit credentials and current memberships on every admission. */
export const nativeAdapter = accountKitAuthority<MasqueradeUser>({
  namespace: 'capacitylens',
  incarnation: 'id',
  provider: sessionUsers,
  kit: () => accountKit,
  managedGuard,
})

function requestedCompanyId(request?: HttpContext): string | null {
  if (!request) return null
  const value = request.params.companyId
  return typeof value === 'string' && value ? value : null
}

/** The product's Masquerade policy: who may view whom, and in which company. */
@inject()
export class MasqueradeAuthorityService {
  #authorization: AuthorizationService

  constructor(authorization: AuthorizationService) {
    this.#authorization = authorization
  }

  /**
   * Whether the actor may view the target in the request's company, or in any company the actor
   * belongs to when the request names none: the actor holds `masquerade:use` there and the target is an
   * active member who does not rank above the actor.
   */
  async #sharesMasqueradeCompany(actorId: string, targetId: string, request?: HttpContext) {
    const requested = requestedCompanyId(request)
    const companies = requested
      ? [requested]
      : await this.#authorization.listActiveCompanyIds(actorId, undefined)
    for (const companyId of companies) {
      const actorRole = await this.#authorization.getActiveCompanyRole(
        actorId,
        companyId,
        undefined
      )
      const targetRole = await this.#authorization.getActiveCompanyRole(
        targetId,
        companyId,
        undefined
      )
      if (actorRole && targetRole && canMasqueradeAs(actorRole, targetRole)) return true
    }
    return false
  }

  /** The policy the Masquerade package asks on every admission and request. */
  readonly masqueradePolicy: MasqueradePolicy<MasqueradeUser, HttpContext> = {
    canMasquerade: async ({ actor, target, request }) =>
      actor.id !== target.id && (await this.#sharesMasqueradeCompany(actor.id, target.id, request)),
    canUseRequest: ({ actor, target, request }) =>
      this.#sharesMasqueradeCompany(actor.id, target.id, request),
  }
}
