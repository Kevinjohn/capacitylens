import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openNativeDatabase } from './native.js'
import type { BackupConfig } from '../../../config/backup.js'
import { buildSnapshotName, parseSnapshotTimestamp } from './names.js'
import { listSnapshots, pruneSnapshots, readMainDatabaseIdentity } from './retention.js'
import {
  durableSnapshotPublisher,
  ensurePrivateBackupDirectory,
  writeOneShotSnapshot,
  type SnapshotPublisher,
} from './snapshot.js'

/** Backup service that coalesces concurrent snapshots and drains on shutdown. */
export interface Backups {
  snapshotNow(): Promise<string>
  stop(): Promise<void>
}

const DAY_MS = 24 * 60 * 60_000

/** Start the web scheduler after validating the source file and backup directory. */
export function startBackups(input: {
  dbPath: string
  config: BackupConfig
  log?: (message: string) => void
  now?: () => Date
  publisher?: SnapshotPublisher
  schedule?: (callback: () => void, delayMs: number) => () => void
}): Backups {
  const {
    dbPath,
    config,
    log = console.log,
    now = () => new Date(),
    publisher,
    schedule = (callback, delayMs) => {
      const timer = setInterval(callback, delayMs)
      timer.unref()
      return () => clearInterval(timer)
    },
  } = input
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
  let lastStampMs = Math.max(0, ...listSnapshots(config.dir, identity).map(parseSnapshotTimestamp))
  let pending: Promise<string> | null = null
  let stopping = false
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
      log(`backup written ${file}${pruned ? ` (pruned ${pruned})` : ''}`)
      return file
    } finally {
      database?.close()
    }
  }
  const backups: Backups = {
    snapshotNow() {
      if (stopping)
        return Promise.reject(new Error('backups stopped — snapshot refused during shutdown'))
      if (pending) return pending
      const run = write()
      pending = run
      const clear = () => {
        if (pending === run) pending = null
      }
      run.then(clear, clear)
      return run
    },
    async stop() {
      stopping = true
      cancelSchedule()
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
  const cancelSchedule = schedule(safely, DAY_MS)
  return backups
}
