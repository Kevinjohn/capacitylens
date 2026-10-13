import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { openNativeDatabase } from './native.js'
import type { BackupConfig } from '../../../config/backup.js'
import { buildSnapshotName, parseSnapshotTimestamp, TMP_RE } from './names.js'
import {
  isProtectedDatabasePath,
  listSnapshots,
  pruneSnapshots,
  readMainDatabaseIdentity,
} from './retention.js'
import {
  durableSnapshotPublisher,
  ensurePrivateBackupDirectory,
  writeOneShotSnapshot,
  type SnapshotPublisher,
} from './snapshot.js'

/** Process-lifetime result of attempted snapshots. */
export interface BackupHealth {
  degraded: boolean
  lastSuccessAt: string | null
}

/** Serialized backup service and its shutdown drain. */
export interface Backups {
  readonly health: Readonly<BackupHealth>
  snapshotNow(): Promise<string>
  stop(): Promise<void>
}

let active: Backups | null = null
/** Return null until the scheduler is active, including when backups are disabled. */
export function backupHealth(): Readonly<BackupHealth> | null {
  return active?.health ?? null
}

/** Publish the provider-owned scheduler to readiness checks. */
export function setActiveBackups(backups: Backups | null): void {
  active = backups
}

/** Start the web scheduler after validating the source file and backup directory. */
export function startBackups(input: {
  dbPath: string
  config: BackupConfig
  log?: (message: string) => void
  now?: () => Date
  publisher?: SnapshotPublisher
}): Backups {
  const { dbPath, config, log = console.log, now = () => new Date(), publisher } = input
  if (!dbPath || dbPath === ':memory:' || /^file:.*(?:\?|&)mode=memory(?:&|$)/i.test(dbPath))
    throw new Error('Backups require a file-backed SQLite database')
  ensurePrivateBackupDirectory(config.dir)
  const source = openNativeDatabase(dbPath, { fileMustExist: true, readonly: true })
  let identity: ReturnType<typeof readMainDatabaseIdentity>
  try {
    identity = readMainDatabaseIdentity(source)
  } finally {
    source.close()
  }
  for (const name of readdirSync(config.dir)) {
    if (!TMP_RE.test(name)) continue
    const path = join(config.dir, name)
    if (isProtectedDatabasePath(path, identity)) continue
    try {
      if (Date.now() - statSync(path).mtimeMs > 60 * 60_000) rmSync(path)
    } catch (error) {
      log(`backup startup sweep skipped ${path}: ${String(error)}`)
    }
  }
  let lastStampMs = Math.max(0, ...listSnapshots(config.dir, identity).map(parseSnapshotTimestamp))
  let pending: Promise<string> | null = null
  let stopping = false
  const health: BackupHealth = { degraded: false, lastSuccessAt: null }
  const write = async (): Promise<string> => {
    let database: ReturnType<typeof openNativeDatabase> | undefined
    try {
      database = openNativeDatabase(dbPath, { fileMustExist: true, readonly: true })
      let file: string
      do {
        lastStampMs = Math.max(now().getTime(), lastStampMs + 1)
        file = join(config.dir, buildSnapshotName(new Date(lastStampMs)))
      } while (existsSync(file))
      await writeOneShotSnapshot({
        database,
        dir: config.dir,
        file,
        label: 'scheduled snapshot',
        log,
        publisher,
        overwrite: false,
      })
      const pruned = pruneSnapshots({
        dir: config.dir,
        keep: config.keep,
        database: identity,
        currentFile: file,
        log,
      })
      if (pruned > 0) {
        try {
          ;(publisher ?? durableSnapshotPublisher).syncDirectory(config.dir)
        } catch (error) {
          log(`backup retention directory sync failed for ${config.dir}: ${String(error)}`)
        }
      }
      health.lastSuccessAt = now().toISOString()
      log(`backup written ${file}${pruned ? ` (pruned ${pruned})` : ''}`)
      return file
    } catch (error) {
      health.degraded = true
      throw error
    } finally {
      database?.close()
    }
  }
  const backups: Backups = {
    health,
    snapshotNow() {
      if (stopping)
        return Promise.reject(new Error('backups stopped — snapshot refused during shutdown'))
      const run = (pending ?? Promise.resolve()).then(write, write)
      pending = run
      const clear = () => {
        if (pending === run) pending = null
      }
      run.then(clear, clear)
      return run
    },
    async stop() {
      stopping = true
      clearInterval(timer)
      while (pending) await pending.catch(() => undefined)
    },
  }
  const safely = () => {
    if (pending) {
      log('backup skipped — previous snapshot still in flight')
      return
    }
    void backups.snapshotNow().catch((error) => log(`backup FAILED — ${String(error)}`))
  }
  safely()
  const timer = setInterval(safely, config.intervalMin * 60_000)
  timer.unref()
  return backups
}
