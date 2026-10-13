import { join, resolve } from 'node:path'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'
import type { BackupConfig } from '#config/backup'
import { openNativeDatabase } from '#services/backup/native'
import { ensurePrivateBackupDirectory, writeOneShotSnapshot } from '#services/backup/snapshot'
import { assertReleasedMigrations } from '#services/released_migrations'
import { assertSchemaIntegrity } from '#services/schema_integrity'

/** Keep mandatory snapshots private without changing the database parent's permissions. */
export function preMigrationBackupDirectory(dbPath: string, configuredDir?: string) {
  return configuredDir ?? `${resolve(dbPath)}.backups`
}

/** Run only released migrations after a verified online SQLite snapshot. */
export default class AppUpgrade extends BaseCommand {
  static commandName = 'app:upgrade'
  static description = 'Back up the SQLite database, then run released migrations'
  static options: CommandOptions = { startApp: true }

  async run() {
    try {
      const connectionConfig = db.getRawConnection(db.primaryConnectionName)?.config
      if (connectionConfig?.client !== 'better-sqlite3')
        throw new Error('app:upgrade requires the configured SQLite connection')
      const dbPath = connectionConfig.connection.filename
      const state = await assertReleasedMigrations({ allowPending: true })
      if (state.pending === 0) {
        await assertSchemaIntegrity()
        this.logger.info('Already up to date')
        return
      }
      const config = this.app.config.get<BackupConfig | null>('backup.settings')
      if (dbPath !== ':memory:' && state.recorded > 0) {
        const dir = preMigrationBackupDirectory(dbPath, config?.dir)
        ensurePrivateBackupDirectory(dir)
        const database = openNativeDatabase(dbPath, { fileMustExist: true, readonly: true })
        try {
          const file = join(
            dir,
            `capacitylens-pre-migration-v${state.recorded}-to-v${state.recorded + state.pending}.db`
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
      await assertReleasedMigrations()
      await assertSchemaIntegrity()
    } catch (error) {
      this.logger.error(`Upgrade failed: ${String(error)}`)
      this.exitCode = 1
    }
  }
}
