import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBackupConfig, startBackups } from './backup'
import { openDb, loadState, insertAll } from './db'
import { seed } from '@floaty/shared/data/seed'

// P4.1 (flag FLOATY_BACKUP_DIR): OFF (unset) means backups don't exist — parseBackupConfig
// is the single gate. ON: snapshots are real, openable SQLite files holding the data, the
// retention prunes oldest-first by filename, and stop() ends the timer (the shutdown path).

const tempDir = () => mkdtempSync(join(tmpdir(), 'floaty-backup-test-'))
const snapshots = (dir: string) => readdirSync(dir).filter((f) => /^floaty-\d{8}-\d{6}\.db$/.test(f)).sort()

/** A fake clock that advances one second per call, so every snapshot gets a unique name. */
function tickingClock(start = new Date('2026-06-13T00:00:00')) {
  let t = start.getTime()
  return () => new Date((t += 1000))
}

describe('parseBackupConfig (fail-closed)', () => {
  it('is null without FLOATY_BACKUP_DIR — backups simply do not exist', () => {
    expect(parseBackupConfig({})).toBeNull()
    expect(parseBackupConfig({ FLOATY_BACKUP_INTERVAL_MIN: '5', FLOATY_BACKUP_KEEP: '3' })).toBeNull()
  })

  it('applies the documented defaults and ignores junk knob values', () => {
    expect(parseBackupConfig({ FLOATY_BACKUP_DIR: '/tmp/x' })).toEqual({ dir: '/tmp/x', intervalMin: 60, keep: 48 })
    expect(
      parseBackupConfig({ FLOATY_BACKUP_DIR: '/tmp/x', FLOATY_BACKUP_INTERVAL_MIN: 'lots', FLOATY_BACKUP_KEEP: '-2' }),
    ).toEqual({ dir: '/tmp/x', intervalMin: 60, keep: 48 })
    expect(
      parseBackupConfig({ FLOATY_BACKUP_DIR: '/tmp/x', FLOATY_BACKUP_INTERVAL_MIN: '15', FLOATY_BACKUP_KEEP: '4' }),
    ).toEqual({ dir: '/tmp/x', intervalMin: 15, keep: 4 })
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
    backups.stop()

    expect(snapshots(dir).length).toBeGreaterThanOrEqual(1)
    // The snapshot opens through the SAME openDb (schema assert included) and holds the data.
    const restored = loadState(openDb(file))
    expect(restored.accounts.length).toBeGreaterThan(0)
    expect(restored.accounts.map((a) => a.name)).toContain('Studio North')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('backup written'))
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
    backups.stop()

    const kept = snapshots(dir)
    expect(kept).toHaveLength(2)
    // Names sort chronologically, so the two NEWEST stamps survive (clock started at 00:00:00,
    // start-up shot + 4 manual = stamps :01..:05; kept = :04 and :05).
    expect(kept[0] < kept[1]).toBe(true)
    expect(readdirSync(dir)).toContain('not-a-snapshot.txt')
  })

  it('the interval timer keeps snapshotting until stop()', async () => {
    const dir = tempDir()
    const db = openDb(':memory:')
    // 0.0005 min = 30ms — the injected tiny interval from the task spec.
    const backups = startBackups(db, { dir, intervalMin: 0.0005, keep: 48 }, () => {}, tickingClock())
    await vi.waitFor(() => expect(snapshots(dir).length).toBeGreaterThanOrEqual(3), { timeout: 5000 })
    backups.stop()
    const after = snapshots(dir).length
    await new Promise((r) => setTimeout(r, 120))
    expect(snapshots(dir)).toHaveLength(after) // no timer left running
  })
})
