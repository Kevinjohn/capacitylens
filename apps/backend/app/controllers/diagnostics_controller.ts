import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import logger from '@adonisjs/core/services/logger';
import db from '@adonisjs/lucid/services/db';
import capacitylens from '#config/capacitylens';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { isOwnerOrAdminOfAnyCompany, readServerDiagnostics } from '#services/diagnostics';

@inject()
export default class DiagnosticsController {
  #currentActor: CurrentActorService;

  constructor(currentActor: CurrentActorService) {
    this.#currentActor = currentActor;
  }

  async show({ auth, response, serialize }: HttpContext) {
    const administers = await this.#currentActor.withActor(auth, (actor, trx) =>
      isOwnerOrAdminOfAnyCompany(actor.userId, trx)
    );
    if (!administers) {
      return response.forbidden({ error: 'Diagnostics are limited to Owners and Admins.' });
    }
    try {
      return serialize(await readServerDiagnostics(db, capacitylens.backupDirectory));
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
