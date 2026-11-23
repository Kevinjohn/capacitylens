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
  async show({ auth, params, serialize }: HttpContext) {
    return serialize(
      await withActor(auth, async (_actor, trx) => {
        await assertCompanyPermission(params.companyId, 'planning:read', trx);
        return {
          dismissed: await isGettingStartedDismissed(trx, params.companyId),
          steps: await readGettingStartedSteps(trx, params.companyId),
        };
      })
    );
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    await request.validateUsing(updateGettingStartedValidator, { data: request.body() });
    const now = new Date().toISOString();
    await withActor(auth, async (_actor, trx) => {
      const { role } = await assertCompanyPermission(params.companyId, 'planning:write', trx);
      if (!isOwnerOrAdmin(role)) {
        throw new IdentityAuthorizationException('Forbidden.');
      }
      await dismissGettingStarted(trx, params.companyId, now);
    });
    return serialize({ dismissed: true });
  }
}
