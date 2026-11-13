import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type db from '@adonisjs/lucid/services/db';
import logger from '@adonisjs/core/services/logger';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { listBundles } from '@kevinjohn/adonisjs-sqlite-backup';
import { checkDatabase } from '#services/state_repository';
import { listActiveCompanyIds, activeCompanyRole } from '#services/auth/authorization';

/** Release level and backup timing are administration facts: Owners and Admins only. */
export async function isAdministratorOfAnyCompany(userId: string, trx: TransactionClientContract) {
  for (const accountId of await listActiveCompanyIds(userId, trx)) {
    const role = await activeCompanyRole(userId, accountId, trx);
    if (isOwnerOrAdmin(role)) return true;
  }
  return false;
}

/**
 * Reads database, schema and backup state; throws when the database cannot be read. `backupDir`
 * is absent when backups are not configured.
 */
export async function readServerDiagnostics(database: Pick<typeof db, 'from'>, backupDir?: string) {
  await checkDatabase();
  const lastMigration = await database
    .from('adonis_schema')
    .select('name')
    .orderBy('id', 'desc')
    .first();
  let newestSnapshotAt: string | null = null;
  if (backupDir) {
    try {
      const times = listBundles(backupDir).map((bundle) => Date.parse(bundle.createdAt));
      newestSnapshotAt = times.length ? new Date(Math.max(...times)).toISOString() : null;
    } catch {
      logger.warn('Diagnostics could not inspect completed snapshots');
    }
  }
  return {
    server: {
      connectivity: 'ok',
      database: { status: 'ok' },
      schema: { migration: lastMigration?.name ?? null },
      backup: { newestSnapshotAt },
    },
  };
}
