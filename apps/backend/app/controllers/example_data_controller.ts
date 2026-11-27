import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { CurrentActorService } from '#services/auth/current_actor_service'
import { AuthorizationService } from '#services/auth/authorization_service'
import { ExampleDataService } from '#services/example_data_service'
import { createExampleDataValidator } from '#validators/example_data'
import { requestData } from '#validators/request_rules'

@inject()
export default class ExampleDataController {
  #currentActor: CurrentActorService
  #authorization: AuthorizationService
  #exampleData: ExampleDataService

  constructor(
    currentActor: CurrentActorService,
    authorization: AuthorizationService,
    exampleData: ExampleDataService
  ) {
    this.#currentActor = currentActor
    this.#authorization = authorization
    this.#exampleData = exampleData
  }

  async store({ auth, request, response, logger, serialize }: HttpContext) {
    const { params } = await request.validateUsing(createExampleDataValidator, {
      data: requestData(request),
    })
    const { companyId } = params
    const added = await this.#currentActor.withActor(auth, async (_actor, trx) => {
      const actor = await this.#authorization.assertCompanyPermission(
        companyId,
        'members:manage',
        trx
      )
      return this.#exampleData.addExampleData(trx, companyId, actor.actorId)
    })
    try {
      logger.info({ companyId, added }, 'Example data committed')
    } catch {
      // The audit and data are already committed; logging is diagnostic only.
    }
    return response.created(await serialize({ added }))
  }
}
