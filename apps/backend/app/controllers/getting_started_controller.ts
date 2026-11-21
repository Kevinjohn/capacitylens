import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { assertCompanyPermission } from '#services/auth/authorization';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';
import {
  dismissGettingStarted,
  isGettingStartedDismissed,
  readGettingStartedSteps,
} from '#services/getting_started';
import { updateGettingStartedValidator } from '#validators/getting_started';

export default class GettingStartedController {
  async show(ctx: HttpContext) {
    const { params, response } = ctx;
    return withActor(ctx, async (_actor, trx) => {
      await assertCompanyPermission(params.companyId, 'planning:read', trx);
      return response.ok({
        dismissed: await isGettingStartedDismissed(trx, params.companyId),
        steps: await readGettingStartedSteps(trx, params.companyId),
      });
    });
  }

  async update(ctx: HttpContext) {
    const { params, request, response } = ctx;
    const [validationError] = await request.tryValidateUsing(updateGettingStartedValidator, {
      data: request.body(),
    });
    // Route wording: this route answers a Vine failure with its own sentence and no code.
    if (validationError) return response.badRequest({ error: 'dismissed must be true.' });
    const now = new Date().toISOString();
    await withActor(ctx, async (_actor, trx) => {
      const { role } = await assertCompanyPermission(params.companyId, 'planning:write', trx);
      if (!isOwnerOrAdmin(role)) {
        throw new IdentityAuthorizationException('Forbidden.');
      }
      await dismissGettingStarted(trx, params.companyId, now);
    });
    return response.ok({ dismissed: true });
  }
}
