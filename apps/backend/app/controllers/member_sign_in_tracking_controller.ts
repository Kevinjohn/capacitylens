import type { HttpContext } from '@adonisjs/core/http';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { changeMemberSignInTracking } from '#services/membership/sign_in_tracking';
import { readRouteParam } from '#services/membership/member_mutation_request';
import { updateMemberTrackingValidator } from '#validators/members';

/** Whether the company records its members' sign-ins. */
export default class MemberSignInTrackingController {
  async update(ctx: HttpContext) {
    const { enabled } = await ctx.request.validateUsing(updateMemberTrackingValidator, {
      data: ctx.request.body(),
    });
    const companyId = readRouteParam(ctx.params.companyId);
    await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyPermission(companyId, 'members:signInTracking', trx);
      await changeMemberSignInTracking(trx, { companyId, actorId: actor.actorId, enabled });
    });
    return ctx.serialize({ enabled });
  }
}
