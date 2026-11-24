import { MemberMutationRequestService } from '#services/membership/member_mutation_request_service';
import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { parseAccountOperation } from '#services/account_operations';
import { MemberResourceLinkService } from '#services/member_resources/member_resource_link_service';
import { clearLinkValidator, setLinkValidator } from '#validators/member_resources';

/** Scoped member/person association. */
@inject()
export default class MemberResourceLinksController {
  #memberMutationRequests: MemberMutationRequestService;
  #links: MemberResourceLinkService;

  constructor(
    links: MemberResourceLinkService,
    memberMutationRequests: MemberMutationRequestService
  ) {
    this.#memberMutationRequests = memberMutationRequests;
    this.#links = links;
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    const body = await request.validateUsing(setLinkValidator, { data: request.body() });
    const command = parseAccountOperation(
      request.header('x-account-operation-id'),
      request.header('idempotency-key')
    );
    const { companyId, userId } = params;
    const result = await this.#memberMutationRequests.run(auth, {
      companyId,
      operation: 'set-member-resource-link',
      command,
      payload: { userId, ...body },
      work: async (trx, { actorId }) => {
        const link = await this.#links.set(trx, {
          companyId,
          userId,
          resourceId: body.resourceId,
          expectedRevision: body.expectedRevision,
          actorId,
        });
        return { resourceId: link.resourceId, revision: link.revision };
      },
    });
    return serialize(result);
  }

  async destroy({ auth, params, request, response }: HttpContext) {
    const body = await request.validateUsing(clearLinkValidator, { data: request.body() });
    const command = parseAccountOperation(
      request.header('x-account-operation-id'),
      request.header('idempotency-key')
    );
    const { companyId, userId } = params;
    await this.#memberMutationRequests.run(auth, {
      companyId,
      operation: 'clear-member-resource-link',
      command,
      payload: { userId, ...body },
      work: async (trx, { actorId }) => {
        await this.#links.clear(trx, {
          companyId,
          userId,
          expectedRevision: body.expectedRevision,
          actorId,
        });
        return { ok: true };
      },
    });
    return response.noContent();
  }
}
