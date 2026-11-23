import type { HttpContext } from '@adonisjs/core/http';
import { decideAdmission } from '#services/admission/admission_decisions';

/**
 * An Owner or Admin approves a person's admission. The Account Kit authorises every decision; it
 * sends no notification.
 */
export default class AdmissionApprovalsController {
  async store({ auth, params, response, serialize }: HttpContext) {
    return decideAdmission({ auth, params, response, serialize }, 'approve');
  }
}
