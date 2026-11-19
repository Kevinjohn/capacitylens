import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type { HttpContext } from '@adonisjs/core/http';
import { errors as vineErrors } from '@vinejs/vine';
import { withActor } from '#services/auth/current_actor';
import { assertCompanyAction, IdentityAuthorityError } from '#services/auth/authorization';
import {
  dismissGettingStarted,
  isGettingStartedDismissed,
  readGettingStartedSteps,
} from '#services/getting_started';
import { updateValidator } from '#validators/getting_started';

export default class GettingStartedController {
  async show(ctx: HttpContext) {
    const { params, response } = ctx;
    return withActor(ctx, async (_actor, trx) => {
      await assertCompanyAction(params.companyId, 'planning:read', trx);
      return response.ok({
        dismissed: await isGettingStartedDismissed(trx, params.companyId),
        steps: await readGettingStartedSteps(trx, params.companyId),
      });
    });
  }

  async update(ctx: HttpContext) {
    const { params, request, response } = ctx;
    try {
      await request.validateUsing(updateValidator, { data: request.body() });
    } catch (error) {
      if (!(error instanceof vineErrors.E_VALIDATION_ERROR)) throw error;
      return response.badRequest({ error: 'dismissed must be true.' });
    }
    const now = new Date().toISOString();
    await withActor(ctx, async (_actor, trx) => {
      const { role } = await assertCompanyAction(params.companyId, 'planning:write', trx);
      if (!isOwnerOrAdmin(role)) {
        throw new IdentityAuthorityError('Forbidden.');
      }
      await dismissGettingStarted(trx, params.companyId, now);
    });
    return response.ok({ dismissed: true });
  }
}
