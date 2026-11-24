import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import logger from '@adonisjs/core/services/logger';
import db from '@adonisjs/lucid/services/db';
import capacitylens from '#config/capacitylens';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { DiagnosticsService } from '#services/diagnostics_service';

@inject()
export default class DiagnosticsController {
  #currentActor: CurrentActorService;
  #diagnostics: DiagnosticsService;

  constructor(currentActor: CurrentActorService, diagnostics: DiagnosticsService) {
    this.#currentActor = currentActor;
    this.#diagnostics = diagnostics;
  }

  async show({ auth, response, serialize }: HttpContext) {
    const administers = await this.#currentActor.withActor(auth, (actor, trx) =>
      this.#diagnostics.isOwnerOrAdminOfAnyCompany(actor.userId, trx)
    );
    if (!administers) {
      return response.forbidden({ error: 'Diagnostics are limited to Owners and Admins.' });
    }
    try {
      return serialize(
        await this.#diagnostics.readServerDiagnostics(db, capacitylens.backupDirectory)
      );
    } catch (error) {
      // Only the error's class is logged: its message can carry a database path.
      logger.warn(
        { code: error instanceof Error ? error.name : 'UNKNOWN' },
        'Diagnostics could not read database state'
      );
      return response.serviceUnavailable({
        server: {
          connectivity: 'ok',
          database: { status: 'unavailable' },
          schema: { migration: null },
          backup: { newestBackupAt: null },
        },
      });
    }
  }
}
