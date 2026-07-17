import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBackupConfig, startBackups, writePreMigrationBackup } from './backup'
import {
  DB_SCHEMA_VERSION,
  initializeOpenDb,
  insertAll,
  loadState,
  openDb,
  openDbConnection,
  planDatabaseMigrations,
} from './db'
import { seed } from '@capacitylens/shared/data/seed'

// P4.1 (flag CAPACITYLENS_BACKUP_DIR): OFF (unset) means backups don't exist — parseBackupConfig
// is the single gate. ON: snapshots are real, openable SQLite files holding the data, the
// retention prunes oldest-first by filename, and stop() ends the timer AND waits for an
// in-flight snapshot (the shutdown path closes the DB right after).

const tempDir = () => mkdtempSync(join(tmpdir(), 'capacitylens-backup-test-'))
const snapshots = (dir: string) => readdirSync(dir).filter((f) => /^capacitylens-\d{8}-\d{6}-\d{3}\.db$/.test(f)).sort()

/** A fake clock that advances one second per call, so every snapshot gets a unique name. */
function tickingClock(start = new Date('2026-06-13T00:00:00')) {
  let t = start.getTime()
  return () => new Date((t += 1000))
}

describe('parseBackupConfig (fail-closed)', () => {
  it('is null without CAPACITYLENS_BACKUP_DIR — backups simply do not exist', () => {
    expect(parseBackupConfig({})).toBeNull()
    expect(parseBackupConfig({ CAPACITYLENS_BACKUP_INTERVAL_MIN: '5', CAPACITYLENS_BACKUP_KEEP: '3' })).toBeNull()
  })

  it('applies the documented defaults and ignores junk knob values', () => {
    expect(parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: '/tmp/x' })).toEqual({ dir: '/tmp/x', intervalMin: 60, keep: 48 })
    expect(
      parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: '/tmp/x', CAPACITYLENS_BACKUP_INTERVAL_MIN: 'lots', CAPACITYLENS_BACKUP_KEEP: '-2' }),
    ).toEqual({ dir: '/tmp/x', intervalMin: 60, keep: 48 })
    expect(parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: '/tmp/x', CAPACITYLENS_BACKUP_KEEP: '0.5' }))
      .toEqual({ dir: '/tmp/x', intervalMin: 60, keep: 48 })
    expect(
      parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: '/tmp/x', CAPACITYLENS_BACKUP_INTERVAL_MIN: '15', CAPACITYLENS_BACKUP_KEEP: '4' }),
    ).toEqual({ dir: '/tmp/x', intervalMin: 15, keep: 4 })
  })

  it('rejects fractional retention values rather than silently changing their meaning', () => {
    expect(parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: '/tmp/x', CAPACITYLENS_BACKUP_KEEP: '100.5' }))
      .toEqual({ dir: '/tmp/x', intervalMin: 60, keep: 48 })
  })
})

describe('pre-migration rollback snapshot', () => {
  it('copies and verifies v7 before the live handle advances through every current migration', async () => {
    const dir = tempDir()
    const dbPath = join(dir, 'capacitylens.db')
    const legacy = openDb(dbPath)
    insertAll(legacy, seed())
    legacy.exec(`
      DROP TABLE capacitylens_schema_migrations;
      PRAGMA user_version = 7;
      PRAGMA application_id = 0;
    `)
    legacy.close()

    const db = openDbConnection(dbPath)
    const plan = planDatabaseMigrations(db)
    expect(plan.fromVersion).toBe(7)
    expect(plan.migrations.map((migration) => migration.version)).toEqual([8, 9, 10, 11, 12, 13, 14])
    const snapshot = await writePreMigrationBackup(
      db,
      { dbPath, fromVersion: plan.fromVersion, toVersion: plan.toVersion, dir: join(dir, 'rollbacks') },
      () => {},
      () => new Date('2026-07-15T12:00:00.123Z'),
    )
    expect(snapshot).not.toBeNull()

    initializeOpenDb(db, dbPath)
    expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(DB_SCHEMA_VERSION)
    db.close()

    const rollback = new DatabaseSync(snapshot!, { readOnly: true })
    expect((rollback.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(7)
    expect((rollback.prepare(`PRAGMA application_id`).get() as { application_id: number }).application_id).toBe(0)
    expect((rollback.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number }).n).toBeGreaterThan(0)
    expect((rollback.prepare(`PRAGMA quick_check`).get() as { quick_check: string }).quick_check).toBe('ok')
    expect((rollback.prepare(`PRAGMA journal_mode`).get() as { journal_mode: string }).journal_mode).toBe('delete')
    rollback.close()
    expect(statSync(snapshot!).mode & 0o777).toBe(0o600)
    expect(existsSync(`${snapshot}.tmp-wal`)).toBe(false)
    expect(existsSync(`${snapshot}.tmp-shm`)).toBe(false)
  })

  it('does not create a rollback artifact for an in-memory database', async () => {
    const db = openDb(':memory:')
    await expect(
      writePreMigrationBackup(db, { dbPath: ':memory:', fromVersion: 7, toVersion: 8 }),
    ).resolves.toBeNull()
    db.close()
  })
})

describe('startBackups', () => {
  it('writes a real, openable snapshot containing the seeded rows', async () => {
    const dir = tempDir()
    const db = openDb(':memory:')
    insertAll(db, seed())
    const log = vi.fn()
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 48 }, log, tickingClock())
    const file = await backups.snapshotNow()
    await backups.stop()

    expect(snapshots(dir).length).toBeGreaterThanOrEqual(1)
    // The snapshot opens through the SAME openDb (schema assert included) and holds the data.
    const restored = loadState(openDb(file))
    expect(restored.accounts.length).toBeGreaterThan(0)
    expect(restored.accounts.map((a) => a.name)).toContain('Studio North')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('backup written'))
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('prunes to the newest `keep` snapshots, oldest first, leaving other files alone', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'not-a-snapshot.txt'), 'keep me')
    const db = openDb(':memory:')
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 2 }, () => {}, tickingClock())
    await backups.snapshotNow()
    await backups.snapshotNow()
    await backups.snapshotNow()
    await backups.snapshotNow()
    await backups.stop()

    const kept = snapshots(dir)
    expect(kept).toHaveLength(2)
    // Names sort chronologically, so the two NEWEST stamps survive (clock started at 00:00:00,
    // start-up shot + 4 manual = stamps :01..:05; kept = :04 and :05).
    expect(kept[0] < kept[1]).toBe(true)
    expect(readdirSync(dir)).toContain('not-a-snapshot.txt')
  })

  it('never reuses a filename, even when the clock does not advance (monotonic stamp bump)', async () => {
    const dir = tempDir()
    const db = openDb(':memory:')
    // A FROZEN clock is the worst case: without the monotonic bump every snapshot would target
    // the same file and silently overwrite the previous one.
    const frozen = () => new Date('2026-06-13T00:00:00')
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 48 }, () => {}, frozen)
    const a = await backups.snapshotNow()
    const b = await backups.snapshotNow()
    await backups.stop()

    expect(a).not.toBe(b)
    // Start-up shot + 2 manual = 3 distinct files despite identical clock readings.
    await vi.waitFor(() => expect(snapshots(dir)).toHaveLength(3))
  })

  it('skips (and logs) an interval tick while a snapshot is still in flight', async () => {
    vi.useFakeTimers()
    const dir = tempDir()
    const db = openDb(':memory:')
    const log = vi.fn()
    const backups = startBackups(db, { dir, intervalMin: 1, keep: 48 }, log, tickingClock())
    try {
      // The start-up snapshot is suspended at its async write (no microtask has run yet); firing
      // the first interval tick NOW must hit the in-flight guard — skipped, with a loud notice.
      vi.advanceTimersByTime(60_000)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('backup skipped'))
      expect(log).toHaveBeenCalledWith(expect.stringContaining('still in flight'))
    } finally {
      // stop() awaits the in-flight start-up snapshot; its write is real I/O, not timer-driven,
      // so it settles fine under fake timers.
      await backups.stop()
      vi.useRealTimers()
    }
    // Let the in-flight start-up snapshot settle: exactly one file, none from the skipped tick.
    await vi.waitFor(() => expect(snapshots(dir)).toHaveLength(1))
  })

  it('the interval timer keeps snapshotting until stop()', async () => {
    const dir = tempDir()
    const db = openDb(':memory:')
    // 0.0005 min = 30ms — the injected tiny interval from the activity spec.
    const backups = startBackups(db, { dir, intervalMin: 0.0005, keep: 48 }, () => {}, tickingClock())
    await vi.waitFor(() => expect(snapshots(dir).length).toBeGreaterThanOrEqual(3), { timeout: 5000 })
    await backups.stop()
    const after = snapshots(dir).length
    await new Promise((r) => setTimeout(r, 120))
    expect(snapshots(dir)).toHaveLength(after) // no timer left running
  })

  it('stop() resolves only after the in-flight start-up snapshot has completed', async () => {
    const dir = tempDir()
    const db = openDb(':memory:')
    insertAll(db, seed())
    const log = vi.fn()
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 48 }, log, tickingClock())
    // The start-up snapshot is still suspended at its async write (no microtask has run yet).
    // stop() must wait it out: the shutdown path (index.ts) closes the DB immediately after,
    // and closing under a running backup can leave a truncated file behind a snapshot name.
    await backups.stop()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('backup written'))
    const files = snapshots(dir)
    expect(files).toHaveLength(1)
    // The file was COMPLETE before stop() resolved — it opens and holds the data.
    const restored = loadState(openDb(join(dir, files[0])))
    expect(restored.accounts.map((a) => a.name)).toContain('Studio North')
  })

  it('never clobbers an existing snapshot after a restart, even with a stuck/stepped-back clock', async () => {
    const dir = tempDir()
    const db = openDb(':memory:')
    // The same frozen clock across both instances is the restart worst case: an in-memory-only
    // monotonic floor resets to 0, so the second instance would reuse the first one's stamp
    // and silently overwrite its file on the node:sqlite backup path.
    const frozen = () => new Date('2026-06-13T01:00:00')
    const first = startBackups(db, { dir, intervalMin: 60, keep: 48 }, () => {}, frozen)
    const before = await first.snapshotNow()
    await first.stop()
    // "Restart": a fresh instance over the same dir must seed its floor from the files on disk.
    const second = startBackups(db, { dir, intervalMin: 60, keep: 48 }, () => {}, frozen)
    const after = await second.snapshotNow()
    await second.stop()

    expect(after).not.toBe(before)
    // Two files per instance (start-up shot + manual), all four distinct — nothing clobbered.
    await vi.waitFor(() => expect(snapshots(dir)).toHaveLength(4))
  })

  it('never overwrites a pre-existing file with the exact colliding name (existsSync backstop)', async () => {
    const dir = tempDir()
    // Force the restart seeding to sit LOW without simulating DST: the pre-v0.15 second-precision
    // name sorts lexicographically AFTER its own '-001' millisecond sibling ('-' < '.'), so the
    // seed reads the OLD-format file as newest and floors at .000 — while a file already occupies
    // the .001 stamp the monotonic bump would otherwise hand out next. Only the existsSync loop
    // stands between the first snapshot and silently clobbering that file.
    const occupied = join(dir, 'capacitylens-20260613-010000-001.db')
    writeFileSync(occupied, 'PRE-EXISTING SNAPSHOT — MUST SURVIVE')
    writeFileSync(join(dir, 'capacitylens-20260613-010000.db'), 'old-format snapshot (seeds the floor)')
    const db = openDb(':memory:')
    const frozen = () => new Date('2026-06-13T01:00:00')
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 48 }, () => {}, frozen)
    const written = await backups.snapshotNow()
    await backups.stop()

    // The occupied name was never reused, let alone overwritten.
    expect(written).not.toBe(occupied)
    expect(readFileSync(occupied, 'utf8')).toBe('PRE-EXISTING SNAPSHOT — MUST SURVIVE')
    // Start-up shot + manual both landed on fresh names past the collision (…-002 / …-003).
    await vi.waitFor(() =>
      expect(readdirSync(dir).filter((f) => /^capacitylens-\d{8}-\d{6}(-\d{3})?\.db$/.test(f))).toHaveLength(4),
    )
  })

  it('sweeps only STALE .tmp files at start-up, sparing fresh ones and other files', async () => {
    const dir = tempDir()
    // A stale temp is a torn write from a crashed process; a FRESH one could be a sibling
    // instance mid-snapshot during a rolling restart — the sweep must not delete its live file.
    const stale = join(dir, 'capacitylens-20260613-000000-000.db.tmp')
    const fresh = join(dir, 'capacitylens-20260613-000000-001.db.tmp')
    writeFileSync(stale, 'torn write from a crash')
    utimesSync(stale, new Date(Date.now() - 2 * 60 * 60_000), new Date(Date.now() - 2 * 60 * 60_000))
    writeFileSync(fresh, 'live write from a sibling instance')
    writeFileSync(join(dir, 'not-a-snapshot.txt'), 'keep me')
    const db = openDb(':memory:')
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 48 }, () => {}, tickingClock())
    await backups.stop()

    const files = readdirSync(dir)
    expect(files).not.toContain('capacitylens-20260613-000000-000.db.tmp')
    expect(files).toContain('capacitylens-20260613-000000-001.db.tmp')
    expect(files).toContain('not-a-snapshot.txt')
    // The sweep is name-scoped: the finished start-up snapshot itself is untouched.
    expect(snapshots(dir)).toHaveLength(1)
  })

  it('the start-up sweep skips (never throws on) an entry it cannot stat, and still boots', async () => {
    const dir = tempDir()
    // A dangling symlink makes statSync throw ENOENT — the same failure shape as a tmp file a
    // sibling process removes between the readdir and the stat. startBackups() runs at module
    // top level with no guard above it, so an unguarded throw here would kill the daemon at
    // boot; the sweep must warn, skip the entry, and carry on (named to sort FIRST, so an
    // unguarded loop would have aborted before reaching the genuinely stale file below).
    symlinkSync(join(dir, 'does-not-exist'), join(dir, 'capacitylens-20260101-000000-000.db.tmp'))
    const stale = join(dir, 'capacitylens-20260102-000000-000.db.tmp')
    writeFileSync(stale, 'torn write from a crash')
    utimesSync(stale, new Date(Date.now() - 2 * 60 * 60_000), new Date(Date.now() - 2 * 60 * 60_000))
    const log = vi.fn()
    const db = openDb(':memory:')
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 48 }, log, tickingClock())
    await backups.stop()

    expect(log).toHaveBeenCalledWith(expect.stringContaining('start-up sweep skipped'))
    // The bad entry was an isolated skip: the stale tmp beyond it was still swept, and the
    // boot completed all the way to the start-up snapshot.
    expect(readdirSync(dir)).not.toContain('capacitylens-20260102-000000-000.db.tmp')
    expect(snapshots(dir)).toHaveLength(1)
  })

  it('a snapshot still succeeds when retention cannot remove an old entry (warn + skip)', async () => {
    const dir = tempDir()
    // A directory squatting on the oldest snapshot name: rmSync without `recursive` refuses
    // it — the same "delete failed" shape as an EACCES, while `force: true` already absorbs
    // the ENOENT of a file pruned out from under us. Either way the new snapshot has ALREADY
    // been renamed into place when prune() runs, so the caller must see success — a rejection
    // here would be a false runbook alarm over a backup that exists.
    mkdirSync(join(dir, 'capacitylens-20200101-000000-000.db'))
    const log = vi.fn()
    const db = openDb(':memory:')
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 1 }, log, tickingClock())
    await expect(backups.snapshotNow()).resolves.toMatch(/\.db$/)
    await backups.stop()

    expect(log).toHaveBeenCalledWith(expect.stringContaining('retention failed to remove'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('backup written'))
    // The unremovable entry is skipped in place (retried next prune), not a fatal.
    expect(readdirSync(dir)).toContain('capacitylens-20200101-000000-000.db')
  })

  it('a failed snapshot removes its temp file and surfaces the original error', async () => {
    const dir = tempDir()
    const db = openDb(':memory:')
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 48 }, () => {}, tickingClock())
    // Let the start-up shot finish cleanly (snapshotNow queues behind it), THEN break the DB:
    // backup()/VACUUM INTO on a closed handle is a realistic mid-write fault.
    await backups.snapshotNow()
    db.close()
    await expect(backups.snapshotNow()).rejects.toThrow()
    await backups.stop()

    // The rejection surfaced to the caller AND no partial `.tmp` was orphaned — under a
    // persistent fault (e.g. ENOSPC) each retry would otherwise leave one behind.
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
    expect(snapshots(dir)).toHaveLength(2) // start-up shot + first manual, both intact
  })

  it('overlapping snapshotNow() calls serialize, and stop() awaits ALL in-flight work', async () => {
    const dir = tempDir()
    const db = openDb(':memory:')
    insertAll(db, seed())
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 48 }, () => {}, tickingClock())
    // Fire two overlapping calls without awaiting (both also overlap the start-up shot). An
    // unserialized implementation would run two writers at once and let the newer call null the
    // guard stop() awaits while the older still runs — shutdown would close the DB under it.
    const order: string[] = []
    const a = backups.snapshotNow().then((f) => {
      order.push('a')
      return f
    })
    const b = backups.snapshotNow().then((f) => {
      order.push('b')
      return f
    })
    await backups.stop()
    order.push('stop')

    // stop() resolved only after BOTH queued snapshots finished, in submission order — so the
    // shutdown path (which closes the DB right after stop()) can never undercut a running write.
    expect(order).toEqual(['a', 'b', 'stop'])
    const [fileA, fileB] = await Promise.all([a, b])
    expect(fileA).not.toBe(fileB)
    // Start-up shot + 2 manual = 3 distinct, COMPLETE files: each opens and holds the data.
    const files = snapshots(dir)
    expect(files).toHaveLength(3)
    for (const f of files) {
      expect(loadState(openDb(join(dir, f))).accounts.map((x) => x.name)).toContain('Studio North')
    }
  })

  it('stop() drains the pre-stop chain, and a snapshotNow() during shutdown is refused', async () => {
    const dir = tempDir()
    const db = openDb(':memory:')
    insertAll(db, seed())
    const backups = startBackups(db, { dir, intervalMin: 60, keep: 48 }, () => {}, tickingClock())
    const order: string[] = []
    // Queued behind the start-up shot, NOT awaited — stop() begins while both are pending.
    const a = backups.snapshotNow().then((f) => {
      order.push('a')
      return f
    })
    const stopped = backups.stop().then(() => order.push('stop'))
    // Chained while stop() is already draining: the pre-fix stop() awaited only the promise it
    // captured at the moment of the await, so a call here would run AFTER stop() resolved —
    // i.e. under the DB close. It is refused instead, loudly, and writes nothing.
    await expect(backups.snapshotNow()).rejects.toThrow(/snapshot refused during shutdown/)
    await stopped

    // stop() resolved only after the whole accepted chain finished.
    expect(order).toEqual(['a', 'stop'])
    // Start-up shot + the one accepted call; the refused call left no file (or temp) behind.
    expect(snapshots(dir)).toHaveLength(2)
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
    expect(await a).toMatch(/\.db$/)
  })
})
