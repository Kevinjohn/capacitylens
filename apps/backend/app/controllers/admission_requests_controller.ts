import type { HttpContext } from '@adonisjs/core/http';
import { readCurrentAccount } from '#services/auth/current_actor';
import { admissionQueryValidator } from '#validators/admission_query';
import { managedGuard } from '#services/auth/managed_guard';
import { resolveAdmission } from '#services/admission/admission_decisions';

/**
 * The caller's own admission request, reachable before admission, and the requests an Owner or
 * Admin decides.
 */
export default class AdmissionRequestsController {
  async store(ctx: HttpContext) {
    const service = await resolveAdmission();
    const record = await service.request(await managedGuard.current(ctx));
    return ctx.serialize({ requestedAt: record.requestedAt });
  }

  async index(ctx: HttpContext) {
    const [validationError, query] = await ctx.request.tryValidateUsing(admissionQueryValidator, {
      data: ctx.request.qs(),
    });
    // Route wording: this list answers a Vine failure with its own sentence and no code.
    if (validationError) {
      return ctx.response.badRequest({ error: 'Invalid admission list request.' });
    }
    const { status, cursor } = query;
    const actor = await readCurrentAccount(ctx);
    const service = await resolveAdmission();
    const page = await service.list({ actorId: actor.id, status, cursor, limit: 100 });
    return ctx.serialize(page);
  }
}
