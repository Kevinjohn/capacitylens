import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { transformState } from '#transformers/state_transformer'
import { CurrentActorService } from '#services/auth/current_actor_service'
import { PlanningAccessService } from '#services/planning/planning_access_service'
import { buildCompanyExport, serializeCompanyExport } from '@capacitylens/shared/data/companyExport'
import { StateRepositoryService } from '#services/state_repository_service'
import { showCompanyExportValidator } from '#validators/export'

/** The company's export document. */
@inject()
export default class CompanyExportController {
  #currentActor: CurrentActorService
  #stateRepository: StateRepositoryService
  #planningAccess: PlanningAccessService

  constructor(
    currentActor: CurrentActorService,
    stateRepository: StateRepositoryService,
    planningAccess: PlanningAccessService
  ) {
    this.#currentActor = currentActor
    this.#stateRepository = stateRepository
    this.#planningAccess = planningAccess
  }

  /**
   * Serves the company's export document as a download. The server reads the rows, projects them
   * for the effective member's role, includes inactive rows only for `members:manage`, and labels
   * the document `full` only for a reader who may see private names.
   */
  async show({ auth, request, response, serialize }: HttpContext) {
    const { params } = await request.validateUsing(showCompanyExportValidator)
    const { companyId } = params
    const text = await this.#currentActor.withActor(auth, async (_actor, trx) => {
      const { planningAccess } = await this.#planningAccess.resolvePlanningAccess(trx, companyId)
      const rows = await this.#stateRepository.readStateWithClient(
        trx,
        companyId,
        this.#stateRepository.mayReadInactive(planningAccess.role)
      )
      return serializeCompanyExport(
        buildCompanyExport(transformState(rows, companyId, planningAccess.role), {
          companyId,
          completeness: planningAccess.canSeePrivateNames ? 'full' : 'redacted',
        })
      )
    })
    response.header('Content-Type', 'application/json; charset=utf-8')
    response.header('Content-Disposition', 'attachment; filename="capacitylens-data.json"')
    return response.send(await serialize.withoutWrapping(text))
  }
}
