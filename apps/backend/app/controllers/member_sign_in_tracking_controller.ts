import { inject } from '@adonisjs/core';
import { MemberSignInTrackingService } from '#services/membership/member_sign_in_tracking_service';
import type { HttpContext } from '@adonisjs/core/http';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { updateMemberTrackingValidator } from '#validators/members';

/** Whether the company records its members' sign-ins. */
@inject()
export default class MemberSignInTrackingController {
  #signInTracking: MemberSignInTrackingService;

  constructor(signInTracking: MemberSignInTrackingService) {
    this.#signInTracking = signInTracking;
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    const { enabled } = await request.validateUsing(updateMemberTrackingValidator, {
      data: request.body(),
    });
    const { companyId } = params;
    await withActor(auth, async (_actor, trx) => {
      const actor = await assertCompanyPermission(companyId, 'members:signInTracking', trx);
      await this.#signInTracking.changeTracking(trx, {
        companyId,
        actorId: actor.actorId,
        enabled,
      });
    });
    return serialize({ enabled });
  }
}
