import type { HttpContext } from '@adonisjs/core/http';
import { changeMemberStatus } from '#services/membership/member_mutations';
import { readRouteParam, runMemberMutation } from '#services/membership/member_mutation_request';
import { changeStatusValidator } from '#validators/members';

/** A member's status, changed under live management permission. */
export default class MemberStatusController {
  async update({ auth, params, request, serialize }: HttpContext) {
    const { status } = await request.validateUsing(changeStatusValidator, {
      data: request.body(),
    });
    const companyId = readRouteParam(params.companyId);
    const userId = readRouteParam(params.userId);
    const result = await runMemberMutation(
      { auth, request },
      {
        companyId,
        operation: 'change-member-status',
        payload: {
          userId,
          status,
        },
        work: (trx, actor) =>
          changeMemberStatus(trx, {
            companyId,
            actorId: actor.actorId,
            userId,
            status,
          }),
      }
    );
    return serialize(result);
  }
}
