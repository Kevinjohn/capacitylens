import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import db from '@adonisjs/lucid/services/db';
import logger from '@adonisjs/core/services/logger';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { listBundles } from '@kevinjohn/adonisjs-sqlite-backup';
import env from '#start/env';
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

/** Reads database, schema and backup state; throws when the database cannot be read. */
export async function readServerDiagnostics() {
  await checkDatabase();
  const lastMigration = await db.from('adonis_schema').select('name').orderBy('id', 'desc').first();
  let newestSnapshotAt: string | null = null;
  const backupDir = env.get('CAPACITYLENS_BACKUP_DIR');
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
