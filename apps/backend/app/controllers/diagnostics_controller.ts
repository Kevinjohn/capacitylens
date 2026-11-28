import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import capacitylens from '#config/capacitylens'
import DiagnosticsUnavailableException from '#exceptions/diagnostics_unavailable_exception'
import { CurrentActorService } from '#services/auth/current_actor_service'
import { DiagnosticsService } from '#services/diagnostics_service'

@inject()
export default class DiagnosticsController {
  #currentActor: CurrentActorService
  #diagnostics: DiagnosticsService

  constructor(currentActor: CurrentActorService, diagnostics: DiagnosticsService) {
    this.#currentActor = currentActor
    this.#diagnostics = diagnostics
  }

  async show({ auth, logger, response, serialize }: HttpContext) {
    const administers = await this.#currentActor.withActor(auth, (actor, trx) =>
      this.#diagnostics.isOwnerOrAdminOfAnyCompany(actor.userId, trx)
    )
    if (!administers) {
      return response.forbidden({ error: 'Diagnostics are limited to Owners and Admins.' })
    }
    try {
      return serialize(
        await this.#diagnostics.readServerDiagnostics(db, capacitylens.backupDirectory, logger)
      )
    } catch (error) {
      // The `err` serializer logs the error's class, never its message, which can carry a database path.
      logger.warn({ err: error }, 'Diagnostics could not read database state')
      throw new DiagnosticsUnavailableException()
    }
  }
}
