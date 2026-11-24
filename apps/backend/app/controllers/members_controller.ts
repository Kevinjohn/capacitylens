import { inject } from '@adonisjs/core';
import { MemberDirectoryService } from '#services/membership/member_directory_service';
import { MemberMutationService } from '#services/membership/member_mutation_service';
import { MemberMutationRequestService } from '#services/membership/member_mutation_request_service';
import type { HttpContext } from '@adonisjs/core/http';
import { AuthorizationService } from '#services/auth/authorization_service';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { changeRoleValidator } from '#validators/members';
import { AccountOperationService } from '#services/account_operation_service';

/** Lists company members and applies member operations under live management permission. */
@inject()
export default class MembersController {
  #authorization: AuthorizationService;
  #currentActor: CurrentActorService;
  #memberDirectory: MemberDirectoryService;
  #memberMutations: MemberMutationService;
  #memberMutationRequests: MemberMutationRequestService;
  #accountOperations: AccountOperationService;

  constructor(
    memberDirectory: MemberDirectoryService,
    memberMutations: MemberMutationService,
    memberMutationRequests: MemberMutationRequestService,
    authorization: AuthorizationService,
    currentActor: CurrentActorService,
    accountOperations: AccountOperationService
  ) {
    this.#memberDirectory = memberDirectory;
    this.#memberMutations = memberMutations;
    this.#memberMutationRequests = memberMutationRequests;
    this.#authorization = authorization;
    this.#currentActor = currentActor;
    this.#accountOperations = accountOperations;
  }

  async index({ auth, params, serialize }: HttpContext) {
    const { companyId } = params;
    const directory = await this.#currentActor.withActor(auth, async (_actor, trx) => {
      const actor = await this.#authorization.assertCompanyPermission(
        companyId,
        'members:manage',
        trx
      );
      return this.#memberDirectory.read(trx, companyId, actor);
    });
    return serialize(directory);
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    const { role } = await request.validateUsing(changeRoleValidator, {
      data: request.body(),
    });
    const { companyId, userId } = params;
    const command = this.#accountOperations.parseAccountOperation(
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
