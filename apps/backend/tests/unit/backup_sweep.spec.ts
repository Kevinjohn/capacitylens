import { test } from '@japa/runner'
import { existsSync, mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openNativeDatabase } from '#services/backup/native'
import { startBackups } from '#services/backup/scheduler'

test('startup sweep removes only matching abandoned temporary backups older than one hour', async ({
  assert,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-backup-sweep-'))
  const dbPath = join(root, 'live.db')
  const dir = join(root, 'backups')
  try {
    const database = openNativeDatabase(dbPath)
    database.prepare('CREATE TABLE adonis_schema (id INTEGER PRIMARY KEY, name TEXT)').run()
    database.close()
    mkdirSync(dir)
    const old = join(dir, 'capacitylens-utc-20200101-000000-000.db.tmp')
    const recent = join(dir, 'capacitylens-utc-20200101-000000-001.db.tmp')
    const unrelated = join(dir, 'other.tmp')
    for (const file of [old, recent, unrelated]) writeFileSync(file, '')
    const oldTime = new Date(Date.now() - 2 * 60 * 60_000)
    utimesSync(old, oldTime, oldTime)
    utimesSync(unrelated, oldTime, oldTime)
    const backups = startBackups({
      dbPath,
      config: { dir, intervalMin: 60, keep: 2 },
      log: () => {},
    })
    assert.isFalse(existsSync(old))
    assert.isTrue(existsSync(recent))
    assert.isTrue(existsSync(unrelated))
    await backups.stop()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
