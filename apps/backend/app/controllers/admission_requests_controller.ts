import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import AdmissionRequestTransformer from '#transformers/admission_request_transformer'
import { admissionQueryValidator } from '#validators/admission'

/**
 * The caller's own admission request, reachable before admission, and the requests an Owner or
 * Admin decides.
 */
@inject()
export default class AdmissionRequestsController {
  #admission: AccountAdmission

  constructor(admission: AccountAdmission) {
    this.#admission = admission
  }

  async store({ auth, serialize }: HttpContext) {
    const record = await this.#admission.request(await auth.use('web').current())
    return serialize({ requestedAt: record.requestedAt })
  }

  async index({ auth, request, serialize }: HttpContext) {
    const query = await request.validateUsing(admissionQueryValidator)
    const { status, cursor } = query
    const actor = auth.getUserOrFail()
    const page = await this.#admission.list({ actorId: actor.id, status, cursor, limit: 100 })
    return serialize(
      AdmissionRequestTransformer.paginate(page.items, { nextCursor: page.nextCursor })
    )
  }
}
