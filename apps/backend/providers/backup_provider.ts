// Backups use the native online SQLite backup of `@kevinjohn/adonisjs-sqlite-backup`; retention
// counts only verified READY bundles.

import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { ApplicationService } from '@adonisjs/core/types'
import logger from '@adonisjs/core/services/logger'
import type { CreateResult, SqliteBackup } from '@kevinjohn/adonisjs-sqlite-backup'
import { backupConfigWarnings, formatBackupStartupFailure, type BackupConfig } from '#config/backup'

const DAY_MS = 24 * 60 * 60_000

/** The package refuses this layout too; this check runs first so startup reports one short, stable message. */
function assertOutsideLiveDatabase(directory: string, livePath: string): void {
  if (!existsSync(directory)) return
  const path = relative(realpathSync(directory), realpathSync(livePath))
  if (path === '' || !(path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))) {
    throw new Error('backup directory contains the live database')
  }
}

/**
 * Owns the web schedule while the package owns copying, verification, retention and restore
 * preparation.
 */
export default class BackupProvider {
  #backup?: SqliteBackup
  #pending?: Promise<CreateResult>
  #cancelSchedule?: () => void
  #stopping = false

  constructor(protected app: ApplicationService) {}

  boot() {
    for (const warning of backupConfigWarnings.splice(0)) {
      this.log(warning, 'warn')
    }
  }

  /** Failures and warnings log above `info`, so a quieter `LOG_LEVEL` still shows them. */
  protected log(message: string, level: 'info' | 'warn' | 'error' = 'info', err?: unknown): void {
    if (err !== undefined) logger[level]({ err }, message)
    else logger[level](message)
  }

  #schedule(callback: () => void, delayMs: number): () => void {
    const timer = setInterval(callback, delayMs)
    timer.unref()
    return () => clearInterval(timer)
  }

  async ready() {
    if (this.app.getEnvironment() !== 'web' || this.#backup || this.#stopping) return
    const config = this.app.config.get<BackupConfig>('backup')
    if (!config.directory) return
    try {
      const backup = await this.app.container.make('sqlite.backup')
      backup.checkSource()
      assertOutsideLiveDatabase(config.directory, backup.livePath())
      backup.prepareDirectory()
      this.#backup = backup
    } catch (error) {
      throw new Error(formatBackupStartupFailure(config.directory, error), { cause: error })
    }
    const run = () => {
      if (this.#pending) {
        this.log('backup skipped — previous backup still in flight')
        return
      }
      void this.runBackup().catch((error) => {
        this.log(`backup FAILED — ${String(error)}`, 'error', error)
        const cleanupError = (error as { cleanupError?: unknown } | null)?.cleanupError
        if (cleanupError !== undefined) {
          this.log(`backup temp cleanup failed: ${String(cleanupError)}`, 'error', cleanupError)
        }
      })
    }
    this.#cancelSchedule = this.#schedule(run, DAY_MS)
    run()
  }

  runBackup(): Promise<CreateResult> {
    if (this.#stopping) return Promise.reject(new Error('backups stopped during shutdown'))
    if (this.#pending) return this.#pending
    const backup = this.#backup
    if (!backup) return Promise.reject(new Error('backups have not started'))
    const run = (async () => {
      const created = await backup.create()
      for (const warning of created.warnings) this.log(`backup warning: ${warning}`, 'warn')
      this.log(`backup written ${created.path}`)
      try {
        const result = await backup.prune()
        for (const failure of result.failed) {
          this.log(`backup retention could not remove ${failure.name}: ${failure.reason}`, 'error')
        }
      } catch (error) {
        this.log(`backup retention failed: ${String(error)}`, 'error', error)
      }
      return created
    })()
    this.#pending = run
    const clear = () => {
      if (this.#pending === run) this.#pending = undefined
    }
    void run.then(clear, clear)
    return run
  }

  async shutdown() {
    this.#stopping = true
    this.#cancelSchedule?.()
    if (this.#pending) await Promise.allSettled([this.#pending])
  }
}
