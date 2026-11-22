import type { HttpContext } from '@adonisjs/core/http';
import { managedGuard } from '#services/auth/managed_guard';
import { resolveAdmission } from '#services/admission/admission_decisions';

/** The caller's own admission status, reachable before admission. */
export default class AdmissionController {
  async show(ctx: HttpContext) {
    const service = await resolveAdmission();
    const { decision } = await service.current(await managedGuard.current(ctx));
    return ctx.response.ok({ decision });
  }
}
