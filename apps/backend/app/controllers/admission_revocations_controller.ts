import type { HttpContext } from '@adonisjs/core/http';
import { decideAdmission, parseUserIdParam } from '#services/admission/admission_decisions';
import { readCurrentAccount } from '#services/auth/current_actor';

/**
 * An Owner or Admin revokes a person's admission. The Account Kit authorises every decision; it
 * sends no notification.
 */
export default class AdmissionRevocationsController {
  async store({ auth, params, response, serialize }: HttpContext) {
    const userId = parseUserIdParam(params.userId);
    if (!userId) return response.badRequest({ error: 'Invalid admission request.' });
    const actor = await readCurrentAccount(auth);
    return serialize(await decideAdmission({ actorId: actor.id, userId, decision: 'revoke' }));
  }
}
