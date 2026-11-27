import { MemberMutationRequestService } from '#services/membership/member_mutation_request_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { MemberResourceLinkService } from '#services/member_resources/member_resource_link_service'
import { clearLinkValidator, setLinkValidator } from '#validators/member_resource'
import { AccountOperationService } from '#services/account_operation_service'
import { requestData } from '#validators/request_rules'

/** Scoped member/person association. */
@inject()
export default class MemberResourceLinksController {
  #memberMutationRequests: MemberMutationRequestService
  #links: MemberResourceLinkService
  #accountOperations: AccountOperationService

  constructor(
    links: MemberResourceLinkService,
    memberMutationRequests: MemberMutationRequestService,
    accountOperations: AccountOperationService
  ) {
    this.#memberMutationRequests = memberMutationRequests
    this.#links = links
    this.#accountOperations = accountOperations
  }

  async update({ auth, request, serialize }: HttpContext) {
    const { params, headers, ...body } = await request.validateUsing(setLinkValidator, {
      data: requestData(request, request.body()),
    })
    const command = this.#accountOperations.resolveAccountOperation(
      headers['x-account-operation-id'],
      headers['idempotency-key']
    )
    const { companyId, userId } = params
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
        })
        return { resourceId: link.resourceId, revision: link.revision }
      },
    })
    return serialize(result)
  }

  async destroy({ auth, request, response }: HttpContext) {
    const { params, headers, ...body } = await request.validateUsing(clearLinkValidator, {
      data: requestData(request, request.body()),
    })
    const command = this.#accountOperations.resolveAccountOperation(
      headers['x-account-operation-id'],
      headers['idempotency-key']
    )
    const { companyId, userId } = params
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
        })
        return { ok: true }
      },
    })
    return response.noContent()
  }
}
