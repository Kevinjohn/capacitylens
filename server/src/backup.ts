import { backup } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db'

// Online DB snapshots (production plan P4.1, flag CAPACITYLENS_BACKUP_DIR — default OFF: this
// module is never started, touches no filesystem, owns no timer). A small server feature
// rather than a host cron because WAL mode means a raw `cp` can catch a torn state —
// node:sqlite's backup() takes a consistent online snapshot instead (fallback:
// VACUUM INTO, same guarantee). Filenames sort chronologically, so retention is a name
// sort; the shutdown path (index.ts) awaits stop(), which clears the timer AND waits for
// any in-flight snapshot, so a drain can't close the DB under a running backup.

export interface BackupConfig {
  dir: string
  /** Snapshot cadence in minutes (CAPACITYLENS_BACKUP_INTERVAL_MIN, default 60). */
  intervalMin: number
  /** Rolling retention count, oldest pruned (CAPACITYLENS_BACKUP_KEEP, default 48). */
  keep: number
}

export interface Backups {
  /** Take one snapshot; resolves to the file written. Also used by the start-up shot.
   *  Concurrency contract: calls SERIALIZE — a call made while another snapshot is in flight
   *  queues behind it (two writers pruning the same dir would race), and each call's own
   *  rejection is its own to surface (a predecessor's failure never fails a queued call).
   *  Rejects immediately once stop() has begun: shutdown closes the DB right after the drain,
   *  so a snapshot accepted here could only run against a closing handle. */
  snapshotNow(): Promise<string>
  /** Clears the timer, then resolves once the WHOLE in-flight snapshot chain has drained — the
   *  shutdown path must not close the DB under a running (or queued) backup. Never rejects. */
  stop(): Promise<void>
}

// The optional `-mmm` millisecond group keeps pre-v0.15 second-precision snapshots inside the
// retention window (they'd otherwise pile up forever); mixed-format names still sort
// chronologically except within a single second, which retention doesn't care about.
const SNAPSHOT_RE = /^capacitylens-\d{8}-\d{6}(-\d{3})?\.db$/

// In-progress writes go to `<snapshot>.tmp` and are renamed on success, so a crash mid-write
// can never leave a torn file behind a valid snapshot name. Deliberately does NOT match
// SNAPSHOT_RE (no `.db$`), so prune() and the stamp seeding both ignore temp files.
const TMP_RE = /^capacitylens-\d{8}-\d{6}(-\d{3})?\.db\.tmp$/

// Only sweep temp files at least this old at start-up. A snapshot takes seconds, so one hour is
// generous headroom for "abandoned by a crashed process" without racing a *live* writer during a
// rolling restart (two instances briefly sharing a dir is unsupported, but the sweep must not be
// the thing that corrupts it). A fixed constant rather than 2× the interval because the interval
// is operator-tunable down to seconds, which would defeat the margin.
const TMP_SWEEP_AGE_MS = 60 * 60_000
export const MAX_BACKUP_INTERVAL_MIN = 35_000
export const MAX_BACKUP_KEEP = 10_000

/** Fail-closed env parse: no CAPACITYLENS_BACKUP_DIR ⇒ null ⇒ backups don't exist. The numeric
 *  knobs are only read when backups are on; junk falls back to the documented defaults. */
export function parseBackupConfig(env: Record<string, string | undefined>): BackupConfig | null {
  const dir = env.CAPACITYLENS_BACKUP_DIR
  if (!dir) return null
  const boundedInteger = (raw: string | undefined, fallback: number, max: number) => {
    const n = Number(raw)
    return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : fallback
  }
  return {
    dir,
    intervalMin: boundedInteger(env.CAPACITYLENS_BACKUP_INTERVAL_MIN, 60, MAX_BACKUP_INTERVAL_MIN),
    keep: boundedInteger(env.CAPACITYLENS_BACKUP_KEEP, 48, MAX_BACKUP_KEEP),
  }
}

function stampName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `capacitylens-${date}-${time}-${ms}.db`
}

/** Parse a snapshot filename back to the epoch ms stampName() built it from (local time,
 *  mirroring stampName); pre-v0.15 second-precision names read as `.000`. Non-snapshot
 *  names return 0 — callers only feed this SNAPSHOT_RE matches. */
function stampMs(name: string): number {
  const m = /^capacitylens-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d{3}))?\.db$/.exec(name)
  if (!m) return 0
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7] : 0).getTime()
}

/** Snapshot filenames in `dir`, oldest first (timestamp names: lexicographic == chronological). */
function listSnapshots(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => SNAPSHOT_RE.test(f))
    .sort()
}

/** Delete the oldest snapshots beyond `keep`; returns how many were pruned. Only files
 *  matching the snapshot pattern are touched — anything else in the dir is left alone.
 *  Never throws: prune() runs AFTER writeSnapshot() has renamed a complete snapshot into
 *  place, so a rejection here would fail (and page an operator over) a backup that actually
 *  SUCCEEDED — a false runbook alarm. Retention is retried on every snapshot anyway. */
function prune(dir: string, keep: number, log: (msg: string) => void): number {
  let files: string[]
  try {
    files = listSnapshots(dir)
  } catch (err) {
    // Can't even list the dir (stale NFS handle, EACCES): retention is skipped this round for
    // the same reason as below — it must not turn a successful snapshot into a rejection.
    log(
      `capacitylens-server: backup retention skipped — cannot list ${dir} — ${err instanceof Error ? err.message : String(err)}`,
    )
    return 0
  }
  const excess = files.length - keep
  let pruned = 0
  for (let i = 0; i < excess; i++) {
    const p = join(dir, files[i])
    try {
      // `force` swallows exactly ENOENT: a file deleted out from under us (external cleanup
      // between the readdir and this rm) is gone either way — that IS the retention outcome.
      rmSync(p, { force: true })
      pruned++
    } catch (err) {
      // Anything else (EACCES after a container uid change, a directory squatting on a
      // snapshot name): surface and skip — the next snapshot's prune retries it.
      log(
        `capacitylens-server: backup retention failed to remove ${p} — ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return pruned
}

export function startBackups(
  db: Db,
  config: BackupConfig,
  log: (msg: string) => void = console.log,
  now: () => Date = () => new Date(),
): Backups {
  // Deliberately fatal (the ONE fs call in start-up allowed to throw): the operator asked for
  // backups via CAPACITYLENS_BACKUP_DIR, and a dir we cannot create means no snapshot can ever
  // be written — booting anyway would silently run without the backups they configured, which
  // is worse than refusing to start. Everything below this line is housekeeping and degrades.
  mkdirSync(config.dir, { recursive: true, mode: 0o700 })

  // Sweep torn temp files from a previous crash mid-snapshot: they never match SNAPSHOT_RE,
  // so prune() would otherwise leave them on disk forever. Age-gated (real wall clock vs the
  // file's mtime, NOT the injected `now`) so a rolling restart can't delete a still-writing
  // sibling's live temp file — an abandoned one is swept on the *next* boot instead.
  // startBackups() runs at module top level (index.ts) with no guard above it, so this sweep
  // must NEVER throw — a stat/rm race with a sibling process, or an EACCES after a container
  // uid change, is a skipped tidy-up, not a reason to take the daemon down at boot.
  let sweepEntries: string[]
  try {
    sweepEntries = readdirSync(config.dir)
  } catch (err) {
    log(
      `capacitylens-server: backup start-up sweep skipped — cannot read ${config.dir} — ${err instanceof Error ? err.message : String(err)}`,
    )
    sweepEntries = []
  }
  for (const f of sweepEntries) {
    if (!TMP_RE.test(f)) continue
    const p = join(config.dir, f)
    try {
      if (Date.now() - statSync(p).mtimeMs > TMP_SWEEP_AGE_MS) rmSync(p)
    } catch (err) {
      // Per-file, so one bad entry (vanished between readdir and stat, unremovable) can't stop
      // the rest of the sweep — it's retried on the next boot.
      log(
        `capacitylens-server: backup start-up sweep skipped ${p} — ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Layered no-clobber guarantee, honest about what each layer covers:
  //   1. Millisecond stamps make same-name collisions unlikely to begin with.
  //   2. The monotonic bump makes reuse impossible among the names THIS instance has issued — two
  //      snapshots in the same ms, or a clock stepping backwards mid-run, bump past the last stamp.
  //   3. The restart seeding (floor = the newest snapshot already on disk) extends that across
  //      restarts — but only approximately: stampMs() parses names with the LOCAL-time Date
  //      constructor, which is ambiguous in the DST fall-back hour, so the seeded floor can sit up
  //      to 1h LOW and a clock rollback could still steer a stamp onto an existing file. It stays
  //      as a good floor (cheap, right outside that hour).
  //   4. The existsSync loop in uniqueStamp() is the DEFINITIVE backstop *within this process*:
  //      whatever the clock or the parse did, a name already on disk is never reused — bump 1ms
  //      and regenerate. It terminates because each iteration strictly advances lastStampMs past
  //      one of finitely many files.
  //   5. Across processes it is only best-effort: existsSync→renameSync is a TOCTOU window, and
  //      POSIX rename silently replaces. The exclusive (`wx`) temp-file claim in writeSnapshot()
  //      closes that window for the *temp* path (two instances can't share one), but the final
  //      rename stays last-writer-wins — the supported deployment is one server process per
  //      SQLite file (and so per backup dir); two daemons sharing one is not defended here.
  // Together these also keep lexicographic == chronological for prune().
  let lastStampMs = 0
  try {
    const newest = listSnapshots(config.dir).at(-1)
    if (newest) lastStampMs = stampMs(newest)
  } catch (err) {
    // Boot-time housekeeping again (see the sweep above): a failed seed scan degrades the
    // floor to 0, which is SAFE against clobbers — layer 4 (the existsSync loop) never reuses
    // a name on disk regardless of where the floor sits. Not worth killing the daemon over.
    log(
      `capacitylens-server: backup stamp seeding skipped — cannot list ${config.dir} — ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const uniqueStamp = (): string => {
    lastStampMs = Math.max(now().getTime(), lastStampMs + 1)
    let name = stampName(new Date(lastStampMs))
    while (existsSync(join(config.dir, name))) {
      lastStampMs += 1
      name = stampName(new Date(lastStampMs))
    }
    return name
  }

  // Tail of the in-flight snapshot chain, or null when idle. Triples as (a) the tick-overlap
  // guard — a slow snapshot must not overlap the next interval tick (two writers in the same
  // dir), so the tick is SKIPPED, loudly, and the following tick covers the gap — (b) the
  // serialization point for direct snapshotNow() calls, which QUEUE behind it rather than skip,
  // and (c) the thing stop() awaits: it always points at the newest queued snapshot, which by
  // construction settles after every predecessor, so the shutdown path can't close the DB under
  // ANY running backup.
  let current: Promise<string> | null = null

  // Set the instant stop() is entered, before its first await: index.ts closes the DB right
  // after stop() resolves, so once shutdown has begun no new snapshot may join the chain.
  let stopping = false

  /** The actual write. Only ever runs serialized (via snapshotNow's chain) — never call directly. */
  const writeSnapshot = async (): Promise<string> => {
    // Claim the temp name EXCLUSIVELY (`wx` = O_EXCL: atomic fail-if-exists) before writing.
    // existsSync in uniqueStamp() only covers finished `.db` names within this process; the
    // exclusive create is what stops a sibling instance from writing into the same temp file.
    // EEXIST just means the name is taken — bump to the next stamp and retry (terminates:
    // uniqueStamp strictly advances past one of finitely many files per iteration).
    let file: string
    let tmp: string
    for (;;) {
      file = join(config.dir, uniqueStamp())
      tmp = `${file}.tmp`
      try {
        writeFileSync(tmp, '', { flag: 'wx', mode: 0o600 })
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
    try {
      // Write to the temp name and rename on success: rename is atomic on the same filesystem,
      // so a torn write (crash, full disk) never sits behind a valid snapshot name.
      // node:sqlite's online backup (verified on Node 24); VACUUM INTO is the pre-approved
      // fallback should the API regress — same consistent-snapshot guarantee. backup() happily
      // overwrites the zero-byte placeholder; VACUUM INTO refuses an existing target, so the
      // fallback drops the placeholder first (re-opening a tiny cross-instance window we accept
      // on this never-taken-today path rather than complicating it).
      if (typeof backup === 'function') await backup(db, tmp)
      else {
        rmSync(tmp)
        db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`)
      }
      renameSync(tmp, file)
    } catch (err) {
      // A failed write must not orphan its temp file: prune() and the start-up sweep both
      // ignore fresh `.tmp`s, so under a persistent fault (e.g. ENOSPC) each retry's partial
      // file would otherwise pile up and WORSEN the very disk-full condition that caused it.
      try {
        rmSync(tmp, { force: true })
      } catch (cleanupErr) {
        // Surface both, but the ORIGINAL error is the one the caller must see — a cleanup
        // failure logging over it would hide the real fault.
        log(
          `capacitylens-server: backup temp cleanup FAILED for ${tmp} — ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
        )
      }
      throw err
    }
    const pruned = prune(config.dir, config.keep, log)
    log(`capacitylens-server: backup written ${file}${pruned > 0 ? ` (pruned ${pruned})` : ''}`)
    return file
  }

  const snapshotNow = (): Promise<string> => {
    // Refuse once shutdown has begun — the honest surface: the caller learns its snapshot did
    // NOT happen, rather than a write racing the DB close (or extending the drain stop() has
    // already promised to finish). Rejection over silence per DEFENSIVE-CODING.md.
    if (stopping) {
      return Promise.reject(new Error('backups stopped — snapshot refused during shutdown'))
    }
    // Serialize: chain onto whatever is in flight so two writers never share the dir (or race
    // `current`, which stop() awaits — an unserialized overlap could null it while the older
    // snapshot still runs, letting shutdown close the DB underneath it). The predecessor's
    // rejection is swallowed HERE only as a queueing detail: its own initiator already surfaces
    // it (safeSnapshot logs; direct callers hold the rejection), and a failed predecessor must
    // not fail this independent snapshot.
    const run = (current ?? Promise.resolve()).then(writeSnapshot, writeSnapshot)
    current = run
    // Clear only our own registration (a caller may already have chained the next snapshot);
    // rejection is the caller's to surface — this handler exists only to reset the guard.
    const clear = () => {
      if (current === run) current = null
    }
    run.then(clear, clear)
    return run
  }

  // A failed snapshot must never crash the daemon — log and try again next tick.
  const safeSnapshot = () => {
    if (current) {
      // Surface, don't silently drop: an operator watching the logs sees WHY a stamp is missing.
      log('capacitylens-server: backup skipped — previous snapshot still in flight')
      return
    }
    void snapshotNow().catch((err: unknown) =>
      log(`capacitylens-server: backup FAILED — ${err instanceof Error ? err.message : String(err)}`),
    )
  }

  safeSnapshot() // one immediately on start, so a fresh deploy is covered before the first hour
  const timer = setInterval(safeSnapshot, config.intervalMin * 60_000)
  timer.unref() // the timer must not keep a draining process alive

  const stop = async (): Promise<void> => {
    stopping = true // synchronously, so nothing can chain onto the tail once we start draining
    clearInterval(timer)
    // Drain the WHOLE chain, not one promise captured at a single instant (the start-up shot
    // is the common SIGTERM race), so the caller can close the DB safely. The `stopping` gate
    // already freezes the chain, but the loop keeps stop()'s contract self-sufficient: it
    // re-reads `current` after each settle (the clear handler nulls it only when it still
    // points at its own run) and only resolves once the tail is stable. Swallowing rejections
    // here is deliberate and safe: every snapshot's own initiator already surfaces its failure
    // (safeSnapshot logs it; direct snapshotNow() callers get the rejection) — stop() only
    // cares that the writes ended.
    while (current) await current.catch(() => undefined)
  }

  return { snapshotNow, stop }
}
