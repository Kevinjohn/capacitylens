import type { ApplicationService } from '@adonisjs/core/types'
import {
  formatBackupStartupFailure,
  type BackupConfig,
  resolveBackupDatabasePath,
} from '#config/backup'
import { startBackups, setActiveBackups, type Backups } from '#services/backup/scheduler'

/** Active web backup scheduler, or null when disabled or stopped. */
export let backupService: Backups | null = null

export default class BackupProvider {
  constructor(protected application: ApplicationService) {}

  async ready() {
    if (this.application.getEnvironment() !== 'web') return
    const config = this.application.config.get<BackupConfig | null>('backup.settings')
    if (!config) return
    try {
      const databaseConfig =
        this.application.config.get<Parameters<typeof resolveBackupDatabasePath>[0]>('database')
      backupService = startBackups({ dbPath: resolveBackupDatabasePath(databaseConfig), config })
      setActiveBackups(backupService)
    } catch (error) {
      throw new Error(formatBackupStartupFailure(config.dir, error), { cause: error })
    }
  }

  async shutdown() {
    try {
      await backupService?.stop()
    } catch (error) {
      console.error(`backup shutdown failed: ${String(error)}`)
      process.exitCode = 1
    } finally {
      backupService = null
      setActiveBackups(null)
    }
  }
}
