import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade'
import { MasqueradeControlService } from '#services/auth/masquerade_control_service'
import { AuthorizationService } from '#services/auth/authorization_service'
import IdentityAuthorizationException from '#exceptions/identity_authorization_exception'
import { E_ACCOUNT_KIT_INVALID_SESSION } from '@kevinjohn/adonisjs-account-kit/errors'
import { CurrentActorService } from '#services/auth/current_actor_service'
import {
  endMasqueradeValidator,
  showMasqueradeValidator,
  startMasqueradeValidator,
} from '#validators/masquerade'
import { requestData } from '#validators/request_rules'

/** Controls the signed-in actor's read-only masquerade mode: status, start and end. */
@inject()
export default class MasqueradeController {
  #masqueradeControl: MasqueradeControlService
  #authorization: AuthorizationService
  #currentActor: CurrentActorService

  constructor(
    masqueradeControl: MasqueradeControlService,
    authorization: AuthorizationService,
    currentActor: CurrentActorService
  ) {
    this.#masqueradeControl = masqueradeControl
    this.#authorization = authorization
    this.#currentActor = currentActor
  }

  async store({ request, serialize }: HttpContext) {
    const body = await request.validateUsing(startMasqueradeValidator)
    const { companyId } = body.params
    const started = await this.#masqueradeControl.startMasquerade(
      body.targetUserId,
      body.headers['x-masquerade-context'] ?? ''
    )
    if (!started.isMasquerading) throw new masqueradeErrors.E_MASQUERADE_UNAVAILABLE()
    return serialize({
      ...(await this.#masqueradeControl.readCurrentMasquerade(db.connection(), companyId)),
      companyId,
    })
  }

  async show({ auth, request, session, serialize }: HttpContext) {
    const { companyId } = await request.validateUsing(showMasqueradeValidator)
    try {
      const signIn = await this.#currentActor.getSignedInSession(auth, session)
      if (!signIn) return serialize({ active: false as const, masqueradeToken: null })
      if (companyId) {
        const mode = await this.#masqueradeControl.readCurrentMasquerade(db.connection(), companyId)
        if (mode.active) return serialize(mode)
        if (
          !(await this.#authorization.getActiveCompanyRole(signIn.userId, companyId, undefined))
        ) {
          throw new IdentityAuthorizationException('Company membership is unavailable.')
        }
        return serialize({ ...mode, companyId })
      }
      return serialize(
        await this.#masqueradeControl.readCurrentMasquerade(db.connection(), undefined)
      )
    } catch (error) {
      // Does work: no session is the inactive status, not a refusal.
      if (error instanceof E_ACCOUNT_KIT_INVALID_SESSION) {
        return serialize({ active: false as const, masqueradeToken: null })
      }
      throw error
    }
  }

  async destroy({ request, serialize }: HttpContext) {
    const body = await request.validateUsing(endMasqueradeValidator, {
      data: requestData(request, request.body()),
    })
    const header = body.headers['x-masquerade-context']
    if (!header) {
      throw new masqueradeErrors.E_MASQUERADE_CONTEXT_REQUIRED()
    }
    if (header !== body.token) throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED()
    const mode = await this.#masqueradeControl.endMasquerade(header)
    return serialize({ active: false as const, masqueradeToken: mode.contextToken })
  }
}
