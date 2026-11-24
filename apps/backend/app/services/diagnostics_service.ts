import { inject } from '@adonisjs/core';
import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type db from '@adonisjs/lucid/services/db';
import logger from '@adonisjs/core/services/logger';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { listBundles } from '@kevinjohn/adonisjs-sqlite-backup';
import { DatabaseHealthService } from '#services/database_health_service';
import { AuthorizationService } from '#services/auth/authorization_service';

/** Server diagnostics and who may read them. */
@inject()
export class DiagnosticsService {
  #authorization: AuthorizationService;
  #databaseHealth: DatabaseHealthService;

  constructor(authorization: AuthorizationService, databaseHealth: DatabaseHealthService) {
    this.#authorization = authorization;
    this.#databaseHealth = databaseHealth;
  }

  /** Release level and backup timing are administration facts: Owners and Admins only. */
  async isOwnerOrAdminOfAnyCompany(userId: string, trx: TransactionClientContract) {
    for (const companyId of await this.#authorization.listActiveCompanyIds(userId, trx)) {
      const role = await this.#authorization.getActiveCompanyRole(userId, companyId, trx);
      if (isOwnerOrAdmin(role)) return true;
    }
    return false;
  }

  /**
   * Reads database, schema and backup state; throws when the database cannot be read. `backupDir`
   * is absent when backups are not configured.
   */
  async readServerDiagnostics(database: Pick<typeof db, 'from'>, backupDir?: string) {
    await this.#databaseHealth.checkDatabase();
    const lastMigration = await database
      .from('adonis_schema')
      .select('name')
      .orderBy('id', 'desc')
      .first();
    let newestBackupAt: string | null = null;
    if (backupDir) {
      try {
        const times = listBundles(backupDir).map((bundle) => Date.parse(bundle.createdAt));
        newestBackupAt = times.length ? new Date(Math.max(...times)).toISOString() : null;
      } catch {
        logger.warn('Diagnostics could not inspect completed backups');
      }
    }
    return {
      server: {
        connectivity: 'ok',
        database: { status: 'ok' },
        schema: { migration: lastMigration?.name ?? null },
        backup: { newestBackupAt },
      },
    };
  }
}
