import { BaseCheck, Result } from '@adonisjs/core/health'
import { backupHealth } from '#services/backup/scheduler'

/** Exposes recovery health without disclosing filesystem paths or raw backup errors. */
export function backupDiagnostics() {
  const health = backupHealth()
  return {
    status:
      health === null
        ? 'unavailable'
        : health.degraded
          ? 'degraded'
          : health.lastSuccessAt === null
            ? 'pending'
            : 'ok',
    lastSuccessAt: health?.lastSuccessAt ?? null,
  }
}

/** Backup failures are advisory: scheduling remains available while recovery is degraded. */
export class BackupCheck extends BaseCheck {
  name = 'Backups'

  async run() {
    const diagnostic = backupDiagnostics()
    const result =
      diagnostic.status === 'degraded'
        ? Result.warning('A backup failed during this process lifetime')
        : diagnostic.status === 'pending'
          ? Result.warning('The first backup has not completed')
          : Result.ok(
              diagnostic.status === 'unavailable'
                ? 'Scheduled backups are disabled'
                : 'The last backup completed'
            )
    return result.mergeMetaData(diagnostic)
  }
}
