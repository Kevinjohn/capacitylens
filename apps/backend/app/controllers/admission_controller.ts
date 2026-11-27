import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'

/** The caller's own admission status, reachable before admission. */
@inject()
export default class AdmissionController {
  #admission: AccountAdmission

  constructor(admission: AccountAdmission) {
    this.#admission = admission
  }

  async show({ auth, serialize }: HttpContext) {
    const { decision } = await this.#admission.current(await auth.use('web').current())
    return serialize({ decision })
  }
}
