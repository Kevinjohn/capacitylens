import type { HttpContext } from '@adonisjs/core/http';
import logger from '@adonisjs/core/services/logger';
import { withActor } from '#services/auth/current_actor';
import { isAdministratorOfAnyCompany, readServerDiagnostics } from '#services/diagnostics';

export default class DiagnosticsController {
  async show(ctx: HttpContext) {
    const { response } = ctx;
    const administers = await withActor(ctx, (actor, trx) =>
      isAdministratorOfAnyCompany(actor.userId, trx)
    );
    if (!administers) {
      return response.forbidden({ error: 'Diagnostics are limited to Owners and Admins.' });
    }
    try {
      return await readServerDiagnostics();
    } catch {
      logger.warn('Diagnostics could not read database state');
      return response.serviceUnavailable({
        server: {
          connectivity: 'ok',
          database: { status: 'unavailable' },
          schema: { migration: null },
          backup: { newestSnapshotAt: null },
        },
      });
    }
  }
}
