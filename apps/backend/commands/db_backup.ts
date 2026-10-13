import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { openNativeDatabase } from '#services/backup/native'
import { resolveBackupDatabasePath, type BackupConfig } from '#config/backup'
import { buildSnapshotName } from '#services/backup/names'
import { ensurePrivateBackupDirectory, writeOneShotSnapshot } from '#services/backup/snapshot'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export default class DbBackup extends BaseCommand {
  static commandName = 'db:backup'
  static description = 'Write and verify a durable SQLite backup in the configured backup directory'
  static options: CommandOptions = { startApp: true }

  async run() {
    const config = this.app.config.get<BackupConfig | null>('backup.settings')
    if (!config) {
      this.logger.error('CAPACITYLENS_BACKUP_DIR is required for db:backup')
      this.exitCode = 1
      return
    }
    let database: ReturnType<typeof openNativeDatabase> | undefined
    try {
      const databaseConfig =
        this.app.config.get<Parameters<typeof resolveBackupDatabasePath>[0]>('database')
      database = openNativeDatabase(resolveBackupDatabasePath(databaseConfig), {
        fileMustExist: true,
        readonly: true,
      })
      let stamp = Date.now()
      let file = join(config.dir, buildSnapshotName(new Date(stamp)))
      while (existsSync(file)) file = join(config.dir, buildSnapshotName(new Date(++stamp)))
      ensurePrivateBackupDirectory(config.dir)
      await writeOneShotSnapshot({ database, dir: config.dir, file, overwrite: false })
      this.logger.success(`Backup written ${file}`)
    } catch (error) {
      this.logger.error(`Backup failed: ${String(error)}`)
      this.exitCode = 1
    } finally {
      database?.close()
    }
  }
}
