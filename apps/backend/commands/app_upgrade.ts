import { join, resolve } from 'node:path';
import { BaseCommand } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import db from '@adonisjs/lucid/services/db';
import type { BackupConfig } from '#config/backup';
import { createBundle, prepareDirectory } from '@kevinjohn/adonisjs-sqlite-backup';
import { assertSchemaIntegrity } from '#services/schema_integrity';

/** Keep mandatory snapshots private without changing the database parent's permissions. */
export function preMigrationBackupDirectory(dbPath: string, configuredDir?: string) {
  return configuredDir ? join(configuredDir, 'pre-migration') : `${resolve(dbPath)}.backups`;
}

/** Run pending migrations after a verified online snapshot of an existing SQLite database. */
export default class AppUpgrade extends BaseCommand {
  static commandName = 'app:upgrade';
  static description = 'Back up the SQLite database, then run pending migrations';
  static options: CommandOptions = { startApp: true };

  async run() {
    try {
      const connectionConfig = db.getRawConnection(db.primaryConnectionName)?.config;
      if (connectionConfig?.client !== 'better-sqlite3') {
        throw new Error('app:upgrade requires the configured SQLite connection');
      }
      const dbPath = connectionConfig.connection.filename;
      const existing = await db
        .from('sqlite_master')
        .where({ type: 'table' })
        .select('name')
        .first();
      const config = this.app.config.get<BackupConfig>('backup');
      if (dbPath !== ':memory:' && existing) {
        const directory = preMigrationBackupDirectory(dbPath, config.directory);
        prepareDirectory(directory);
        const bundle = await createBundle({ livePath: dbPath, directory });
        this.logger.success(`Pre-upgrade backup written ${bundle.path}`);
      }
      const migrate = await this.kernel.exec('migration:run', ['--force', '--no-schema-generate']);
      if (migrate.exitCode !== 0) {
        this.error = migrate.error;
        this.exitCode = migrate.exitCode ?? 1;
        return;
      }
      await assertSchemaIntegrity();
    } catch (error) {
      this.logger.error(`Upgrade failed: ${String(error)}`);
      this.exitCode = 1;
    }
  }
}
