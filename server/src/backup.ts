import { backup } from 'node:sqlite'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db'

// Online DB snapshots (production plan P4.1, flag FLOATY_BACKUP_DIR — default OFF: this
// module is never started, touches no filesystem, owns no timer). A small server feature
// rather than a host cron because WAL mode means a raw `cp` can catch a torn state —
// node:sqlite's backup() takes a consistent online snapshot instead (fallback:
// VACUUM INTO, same guarantee). Filenames sort chronologically, so retention is a name
// sort; the shutdown path (index.ts) stops the timer so a drain doesn't race a snapshot.

export interface BackupConfig {
  dir: string
  /** Snapshot cadence in minutes (FLOATY_BACKUP_INTERVAL_MIN, default 60). */
  intervalMin: number
  /** Rolling retention count, oldest pruned (FLOATY_BACKUP_KEEP, default 48). */
  keep: number
}

export interface Backups {
  /** Take one snapshot now; resolves to the file written. Also used by the start-up shot. */
  snapshotNow(): Promise<string>
  stop(): void
}

const SNAPSHOT_RE = /^floaty-\d{8}-\d{6}\.db$/

/** Fail-closed env parse: no FLOATY_BACKUP_DIR ⇒ null ⇒ backups don't exist. The numeric
 *  knobs are only read when backups are on; junk falls back to the documented defaults. */
export function parseBackupConfig(env: Record<string, string | undefined>): BackupConfig | null {
  const dir = env.FLOATY_BACKUP_DIR
  if (!dir) return null
  const positive = (raw: string | undefined, fallback: number) => {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    dir,
    intervalMin: positive(env.FLOATY_BACKUP_INTERVAL_MIN, 60),
    keep: Math.floor(positive(env.FLOATY_BACKUP_KEEP, 48)),
  }
}

function stampName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `floaty-${date}-${time}.db`
}

/** Delete the oldest snapshots beyond `keep`; returns how many were pruned. Only files
 *  matching the snapshot pattern are touched — anything else in the dir is left alone. */
function prune(dir: string, keep: number): number {
  const files = readdirSync(dir)
    .filter((f) => SNAPSHOT_RE.test(f))
    .sort() // timestamp names: lexicographic == chronological
  const excess = files.length - keep
  for (let i = 0; i < excess; i++) rmSync(join(dir, files[i]))
  return Math.max(0, excess)
}

export function startBackups(
  db: Db,
  config: BackupConfig,
  log: (msg: string) => void = console.log,
  now: () => Date = () => new Date(),
): Backups {
  mkdirSync(config.dir, { recursive: true })

  const snapshotNow = async (): Promise<string> => {
    const file = join(config.dir, stampName(now()))
    // node:sqlite's online backup (verified on Node 24); VACUUM INTO is the pre-approved
    // fallback should the API regress — same consistent-snapshot guarantee.
    if (typeof backup === 'function') await backup(db, file)
    else db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`)
    const pruned = prune(config.dir, config.keep)
    log(`floaty-server: backup written ${file}${pruned > 0 ? ` (pruned ${pruned})` : ''}`)
    return file
  }

  // A failed snapshot must never crash the daemon — log and try again next tick.
  const safeSnapshot = () =>
    void snapshotNow().catch((err: unknown) =>
      log(`floaty-server: backup FAILED — ${err instanceof Error ? err.message : String(err)}`),
    )

  safeSnapshot() // one immediately on start, so a fresh deploy is covered before the first hour
  const timer = setInterval(safeSnapshot, config.intervalMin * 60_000)
  timer.unref() // the timer must not keep a draining process alive

  return { snapshotNow, stop: () => clearInterval(timer) }
}
