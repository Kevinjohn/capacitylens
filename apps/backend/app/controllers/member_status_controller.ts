import { inject } from '@adonisjs/core';
import { MemberMutationService } from '#services/membership/member_mutation_service';
import { MemberMutationRequestService } from '#services/membership/member_mutation_request_service';
import type { HttpContext } from '@adonisjs/core/http';
import { parseAccountOperation } from '#services/account_operations';
import { changeStatusValidator } from '#validators/members';

/** A member's status, changed under live management permission. */
@inject()
export default class MemberStatusController {
  #memberMutations: MemberMutationService;
  #memberMutationRequests: MemberMutationRequestService;

  constructor(
    memberMutations: MemberMutationService,
    memberMutationRequests: MemberMutationRequestService
  ) {
    this.#memberMutations = memberMutations;
    this.#memberMutationRequests = memberMutationRequests;
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    const { status } = await request.validateUsing(changeStatusValidator, {
      data: request.body(),
    });
    const { companyId, userId } = params;
    const command = parseAccountOperation(
      request.header('x-account-operation-id'),
      request.header('idempotency-key')
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
