import { join, resolve } from 'node:path'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'
import type { BackupConfig } from '#config/backup'
import { openNativeDatabase } from '#services/backup/native'
import { buildSnapshotName } from '#services/backup/names'
import { ensurePrivateBackupDirectory, writeOneShotSnapshot } from '#services/backup/snapshot'
import { assertSchemaIntegrity } from '#services/schema_integrity'

/** Keep mandatory snapshots private without changing the database parent's permissions. */
export function preMigrationBackupDirectory(dbPath: string, configuredDir?: string) {
  return configuredDir ?? `${resolve(dbPath)}.backups`
}

/** Run pending migrations after a verified online snapshot of an existing SQLite database. */
export default class AppUpgrade extends BaseCommand {
  static commandName = 'app:upgrade'
  static description = 'Back up the SQLite database, then run pending migrations'
  static options: CommandOptions = { startApp: true }

  async run() {
    try {
      const connectionConfig = db.getRawConnection(db.primaryConnectionName)?.config
      if (connectionConfig?.client !== 'better-sqlite3')
        throw new Error('app:upgrade requires the configured SQLite connection')
      const dbPath = connectionConfig.connection.filename
      const existing = await db
        .from('sqlite_master')
        .where({ type: 'table' })
        .select('name')
        .first()
      const config = this.app.config.get<BackupConfig | null>('backup.settings')
      if (dbPath !== ':memory:' && existing) {
        const dir = preMigrationBackupDirectory(dbPath, config?.dir)
        ensurePrivateBackupDirectory(dir)
        const database = openNativeDatabase(dbPath, { fileMustExist: true, readonly: true })
        try {
          // The pre-migration prefix keeps upgrade snapshots out of scheduled retention.
          const file = join(
            dir,
            buildSnapshotName(new Date()).replace('capacitylens-', 'capacitylens-pre-migration-')
          )
          await writeOneShotSnapshot({ database, dir, file, label: 'pre-upgrade snapshot' })
          this.logger.success(`Pre-upgrade backup written ${file}`)
        } finally {
          database.close()
        }
      }
      const migrate = await this.kernel.exec('migration:run', ['--force', '--no-schema-generate'])
      if (migrate.exitCode !== 0) {
        this.error = migrate.error
        this.exitCode = migrate.exitCode || 1
        return
      }
      await assertSchemaIntegrity()
    } catch (error) {
      this.logger.error(`Upgrade failed: ${String(error)}`)
      this.exitCode = 1
    }
  }
}
