import { inject } from '@adonisjs/core';
import { MemberMutationService } from '#services/membership/member_mutation_service';
import { MemberMutationRequestService } from '#services/membership/member_mutation_request_service';
import type { HttpContext } from '@adonisjs/core/http';
import { changeStatusValidator } from '#validators/members';
import { AccountOperationService } from '#services/account_operation_service';
import { requestData } from '#validators/request_rules';

/** A member's status, changed under live management permission. */
@inject()
export default class MemberStatusController {
  #memberMutations: MemberMutationService;
  #memberMutationRequests: MemberMutationRequestService;
  #accountOperations: AccountOperationService;

  constructor(
    memberMutations: MemberMutationService,
    memberMutationRequests: MemberMutationRequestService,
    accountOperations: AccountOperationService
  ) {
    this.#memberMutations = memberMutations;
    this.#memberMutationRequests = memberMutationRequests;
    this.#accountOperations = accountOperations;
  }

  async update({ auth, request, serialize }: HttpContext) {
    const { status, params, headers } = await request.validateUsing(changeStatusValidator, {
      data: requestData(request, request.body()),
    });
    const { companyId, userId } = params;
    const command = this.#accountOperations.resolveAccountOperation(
      headers['x-account-operation-id'],
      headers['idempotency-key']
    );
    const result = await this.#memberMutationRequests.run(auth, {
      companyId,
      operation: 'change-member-status',
      command,
      payload: {
        userId,
        status,
      },
      work: (trx, actor) =>
        this.#memberMutations.changeStatus(trx, {
          companyId,
          actorId: actor.actorId,
          userId,
          status,
        }),
    });
    return serialize(result);
  }
}
