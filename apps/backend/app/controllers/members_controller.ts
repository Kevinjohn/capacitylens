import type { HttpContext } from '@adonisjs/core/http';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { changeMemberRole } from '#services/membership/member_mutations';
import { readMemberDirectory } from '#services/membership/member_directory';
import { readRouteParam, runMemberMutation } from '#services/membership/member_mutation_request';
import { changeRoleValidator } from '#validators/members';

/** Lists company members and applies member operations under live management permission. */
export default class MembersController {
  async index(ctx: HttpContext) {
    const companyId = readRouteParam(ctx.params.companyId);
    const directory = await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyPermission(companyId, 'members:manage', trx);
      return readMemberDirectory(trx, companyId, actor);
    });
    return ctx.serialize(directory);
  }

  async update(ctx: HttpContext) {
    const { role } = await ctx.request.validateUsing(changeRoleValidator, {
      data: ctx.request.body(),
    });
    const companyId = readRouteParam(ctx.params.companyId);
    const userId = readRouteParam(ctx.params.userId);
    const result = await runMemberMutation(ctx, {
      companyId,
      operation: 'change-member-role',
      payload: {
        userId,
        role,
      },
      work: (trx, actor) =>
        changeMemberRole(trx, {
          companyId,
          actorId: actor.actorId,
          userId,
          role,
        }),
    });
    return ctx.serialize(result);
  }
}
