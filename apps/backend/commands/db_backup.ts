import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { openNativeDatabase } from '#services/backup/native'
import { resolveBackupDatabasePath, type BackupConfig } from '#config/backup'
import { buildSnapshotName, parseSnapshotTimestamp } from '#services/backup/names'
import {
  durableSnapshotPublisher,
  ensurePrivateBackupDirectory,
  writeOneShotSnapshot,
} from '#services/backup/snapshot'
import { listSnapshots, pruneSnapshots, readMainDatabaseIdentity } from '#services/backup/retention'
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
      ensurePrivateBackupDirectory(config.dir)
      const identity = readMainDatabaseIdentity(database)
      let stamp = Math.max(
        Date.now(),
        ...listSnapshots(config.dir, identity).map(parseSnapshotTimestamp)
      )
      let file = join(config.dir, buildSnapshotName(new Date(stamp)))
      while (existsSync(file)) file = join(config.dir, buildSnapshotName(new Date(++stamp)))
      await writeOneShotSnapshot({
        database,
        dir: config.dir,
        file,
        overwrite: false,
        log: (message) => this.logger.warning(message),
      })
      const pruned = pruneSnapshots({
        dir: config.dir,
        keep: config.keep,
        database: identity,
        currentFile: file,
        log: (message) => this.logger.warning(message),
      })
      if (pruned > 0) {
        try {
          durableSnapshotPublisher.syncDirectory(config.dir)
        } catch (error) {
          this.logger.warning(`backup retention directory sync failed: ${String(error)}`)
        }
      }
      this.logger.success(`Backup written ${file}${pruned ? ` (pruned ${pruned})` : ''}`)
    } catch (error) {
      this.logger.error(`Backup failed: ${String(error)}`)
      this.exitCode = 1
    } finally {
      database?.close()
    }
  }
}
