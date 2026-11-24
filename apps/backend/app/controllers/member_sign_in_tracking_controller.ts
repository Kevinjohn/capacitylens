import type { HttpContext } from '@adonisjs/core/http';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { changeMemberSignInTracking } from '#services/membership/sign_in_tracking';
import { updateMemberTrackingValidator } from '#validators/members';

/** Whether the company records its members' sign-ins. */
export default class MemberSignInTrackingController {
  async update({ auth, params, request, serialize }: HttpContext) {
    const { enabled } = await request.validateUsing(updateMemberTrackingValidator, {
      data: request.body(),
    });
    const { companyId } = params;
    await withActor(auth, async (_actor, trx) => {
      const actor = await assertCompanyPermission(companyId, 'members:signInTracking', trx);
      await changeMemberSignInTracking(trx, { companyId, actorId: actor.actorId, enabled });
    });
    return serialize({ enabled });
  }
}
