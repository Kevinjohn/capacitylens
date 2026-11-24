import type { HttpContext } from '@adonisjs/core/http';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { changeMemberRole } from '#services/membership/member_mutations';
import { readMemberDirectory } from '#services/membership/member_directory';
import { parseAccountOperation } from '#services/account_operations';
import { runMemberMutation } from '#services/membership/member_mutation_request';
import { changeRoleValidator } from '#validators/members';

/** Lists company members and applies member operations under live management permission. */
export default class MembersController {
  async index({ auth, params, serialize }: HttpContext) {
    const { companyId } = params;
    const directory = await withActor(auth, async (_actor, trx) => {
      const actor = await assertCompanyPermission(companyId, 'members:manage', trx);
      return readMemberDirectory(trx, companyId, actor);
    });
    return serialize(directory);
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    const { role } = await request.validateUsing(changeRoleValidator, {
      data: request.body(),
    });
    const { companyId, userId } = params;
    const command = parseAccountOperation(
      request.header('x-account-operation-id'),
      request.header('idempotency-key')
    );
    const result = await runMemberMutation(auth, {
      companyId,
      operation: 'change-member-role',
      command,
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
    return serialize(result);
  }
}
