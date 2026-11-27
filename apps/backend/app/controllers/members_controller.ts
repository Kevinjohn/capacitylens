import { inject } from '@adonisjs/core'
import { MemberDirectoryService } from '#services/membership/member_directory_service'
import { MemberMutationService } from '#services/membership/member_mutation_service'
import { MemberMutationRequestService } from '#services/membership/member_mutation_request_service'
import type { HttpContext } from '@adonisjs/core/http'
import { AuthorizationService } from '#services/auth/authorization_service'
import { CurrentActorService } from '#services/auth/current_actor_service'
import { changeRoleValidator, listMembersValidator } from '#validators/members'
import { AccountOperationService } from '#services/account_operation_service'

/** Lists company members and applies member operations under live management permission. */
@inject()
export default class MembersController {
  #authorization: AuthorizationService
  #currentActor: CurrentActorService
  #memberDirectory: MemberDirectoryService
  #memberMutations: MemberMutationService
  #memberMutationRequests: MemberMutationRequestService
  #accountOperations: AccountOperationService

  constructor(
    memberDirectory: MemberDirectoryService,
    memberMutations: MemberMutationService,
    memberMutationRequests: MemberMutationRequestService,
    authorization: AuthorizationService,
    currentActor: CurrentActorService,
    accountOperations: AccountOperationService
  ) {
    this.#memberDirectory = memberDirectory
    this.#memberMutations = memberMutations
    this.#memberMutationRequests = memberMutationRequests
    this.#authorization = authorization
    this.#currentActor = currentActor
    this.#accountOperations = accountOperations
  }

  async index({ auth, request, serialize }: HttpContext) {
    const { params } = await request.validateUsing(listMembersValidator)
    const { companyId } = params
    const directory = await this.#currentActor.withActor(auth, async (_actor, trx) => {
      const actor = await this.#authorization.assertCompanyPermission(
        companyId,
        'members:manage',
        trx
      )
      return this.#memberDirectory.read(trx, companyId, actor)
    })
    return serialize(directory)
  }

  async update({ auth, request, serialize }: HttpContext) {
    const { role, params, headers } = await request.validateUsing(changeRoleValidator)
    const { companyId, userId } = params
    const command = this.#accountOperations.resolveAccountOperation(
      headers['x-account-operation-id'],
      headers['idempotency-key']
    )
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
    })
    return serialize(result)
  }
}
