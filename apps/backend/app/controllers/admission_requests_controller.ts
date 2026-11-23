import type { HttpContext } from '@adonisjs/core/http';
import { readCurrentAccount } from '#services/auth/current_actor';
import { admissionQueryValidator } from '#validators/admission_query';
import { resolveAdmission } from '#services/admission/admission_decisions';

/**
 * The caller's own admission request, reachable before admission, and the requests an Owner or
 * Admin decides.
 */
export default class AdmissionRequestsController {
  async store({ auth, serialize }: HttpContext) {
    const service = await resolveAdmission();
    const record = await service.request(await auth.use('web').current());
    return serialize({ requestedAt: record.requestedAt });
  }

  async index({ auth, request, response, serialize }: HttpContext) {
    const [validationError, query] = await request.tryValidateUsing(admissionQueryValidator, {
      data: request.qs(),
    });
    // Route wording: this list answers a Vine failure with its own sentence and no code.
    if (validationError) {
      return response.badRequest({ error: 'Invalid admission list request.' });
    }
    const { status, cursor } = query;
    const actor = await readCurrentAccount(auth);
    const service = await resolveAdmission();
    const page = await service.list({ actorId: actor.id, status, cursor, limit: 100 });
    return serialize(page);
  }
}
