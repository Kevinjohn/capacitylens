import { inject } from '@adonisjs/core';
import { MemberDirectoryService } from '#services/membership/member_directory_service';
import { MemberMutationService } from '#services/membership/member_mutation_service';
import { MemberMutationRequestService } from '#services/membership/member_mutation_request_service';
import type { HttpContext } from '@adonisjs/core/http';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { parseAccountOperation } from '#services/account_operations';
import { changeRoleValidator } from '#validators/members';

/** Lists company members and applies member operations under live management permission. */
@inject()
export default class MembersController {
  #memberDirectory: MemberDirectoryService;
  #memberMutations: MemberMutationService;
  #memberMutationRequests: MemberMutationRequestService;

  constructor(
    memberDirectory: MemberDirectoryService,
    memberMutations: MemberMutationService,
    memberMutationRequests: MemberMutationRequestService
  ) {
    this.#memberDirectory = memberDirectory;
    this.#memberMutations = memberMutations;
    this.#memberMutationRequests = memberMutationRequests;
  }

  async index({ auth, params, serialize }: HttpContext) {
    const { companyId } = params;
    const directory = await withActor(auth, async (_actor, trx) => {
      const actor = await assertCompanyPermission(companyId, 'members:manage', trx);
      return this.#memberDirectory.read(trx, companyId, actor);
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
    const result = await this.#memberMutationRequests.run(auth, {
      companyId,
      operation: 'change-member-role',
      command,
      payload: {
        userId,
        role,
      },
      work: (trx, actor) =>
        this.#memberMutations.changeRole(trx, {
          companyId,
          actorId: actor.actorId,
          userId,
          role,
        }),
    });
    return serialize(result);
  }
}
