import type { HttpContext } from '@adonisjs/core/http';
import { resolveAdmission } from '#services/admission/admission_decisions';

/** The caller's own admission status, reachable before admission. */
export default class AdmissionController {
  async show({ auth, serialize }: HttpContext) {
    const service = await resolveAdmission();
    const { decision } = await service.current(await auth.use('web').current());
    return serialize({ decision });
  }
}
