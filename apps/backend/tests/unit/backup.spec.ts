import { test } from '@japa/runner'
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  renameSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseBackupConfig, resolveBackupDatabasePath } from '#config/backup'
import { openNativeDatabase } from '#services/backup/native'
import { startBackups } from '#services/backup/scheduler'
import {
  durableSnapshotPublisher,
  ensurePrivateBackupDirectory,
  writeOneShotSnapshot,
} from '#services/backup/snapshot'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-backup-'))
  const dbPath = join(root, 'live.db')
  const database = openNativeDatabase(dbPath)
  database.prepare('CREATE TABLE adonis_schema (id INTEGER PRIMARY KEY, name TEXT NOT NULL)').run()
  database.prepare('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL)').run()
  database.prepare("INSERT INTO adonis_schema(name) VALUES ('baseline')").run()
  database.prepare("INSERT INTO entries(value) VALUES ('before')").run()
  database.close()
  return {
    root,
    dbPath,
    dir: join(root, 'backups'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('backup config remains disabled without a directory and bounds retention', ({ assert }) => {
  const warnings: string[] = []
  assert.isNull(
    parseBackupConfig({ CAPACITYLENS_BACKUP_KEEP: 'bad' }, warnings.push.bind(warnings))
  )
  assert.lengthOf(warnings, 0)
  assert.deepEqual(parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: '/tmp/b' }), {
    dir: '/tmp/b',
    keep: 48,
  })
  assert.deepEqual(
    parseBackupConfig(
      {
        CAPACITYLENS_BACKUP_DIR: '/tmp/b',
        CAPACITYLENS_BACKUP_INTERVAL_MIN: '1',
        CAPACITYLENS_BACKUP_KEEP: '100.5',
      },
      warnings.push.bind(warnings)
    ),
    { dir: '/tmp/b', keep: 100 }
  )
  assert.lengthOf(warnings, 1)
})

test('native online backup is verified, private and restores a consistent state during writes', async ({
  assert,
}) => {
  const f = fixture()
  try {
    const live = openNativeDatabase(f.dbPath)
    live.pragma('journal_mode = WAL')
    const file = join(f.dir, 'rollback.db')
    ensurePrivateBackupDirectory(f.dir)
    const snapshot = writeOneShotSnapshot({ database: live, dir: f.dir, file })
    const writer = openNativeDatabase(f.dbPath)
    writer.prepare('BEGIN IMMEDIATE').run()
    writer.prepare("UPDATE entries SET value = 'after'").run()
    writer.prepare("INSERT INTO entries(value) VALUES ('commit-marker')").run()
    writer.prepare('COMMIT').run()
    writer.close()
    await snapshot
    assert.equal(statSync(f.dir).mode & 0o777, 0o700)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    live.close()
    writeFileSync(f.dbPath, Buffer.from('corrupt live database'))
    assert.throws(() => openNativeDatabase(f.dbPath).prepare('SELECT value FROM entries').all())
    const restoreTmp = join(f.root, 'restore.tmp')
    copyFileSync(file, restoreTmp)
    const candidate = openNativeDatabase(restoreTmp)
    assert.deepEqual(candidate.pragma('quick_check'), [{ quick_check: 'ok' }])
    assert.deepEqual(candidate.pragma('foreign_key_check'), [])
    candidate.close()
    renameSync(restoreTmp, f.dbPath)
    const restored = openNativeDatabase(f.dbPath)
    const values = restored.prepare('SELECT value FROM entries ORDER BY id').all() as Array<{
      value: string
    }>
    assert.isTrue(
      JSON.stringify(values) === JSON.stringify([{ value: 'before' }]) ||
        JSON.stringify(values) === JSON.stringify([{ value: 'after' }, { value: 'commit-marker' }])
    )
    restored.close()
  } finally {
    f.cleanup()
  }
})

test('scheduler coalesces overlapping snapshots, keeps restore points and surfaces failures', async ({
  assert,
}) => {
  const f = fixture()
  try {
    const config = { dir: f.dir, keep: 2 }
    const backups = startBackups({ dbPath: f.dbPath, config, log: () => {} })
    await backups.snapshotNow()
    await backups.snapshotNow()
    assert.equal(readdirSync(f.dir).filter((name) => name.endsWith('.db')).length, 2)
    rmSync(f.dbPath)
    await assert.rejects(() => backups.snapshotNow())
    await backups.stop()
    await assert.rejects(() => backups.snapshotNow(), /stopped/)
  } finally {
    f.cleanup()
  }
})

test('scheduled backup failures are logged', async ({ assert }) => {
  const f = fixture()
  const messages: string[] = []
  let recordFailure!: () => void
  const failed = new Promise<void>((resolve) => {
    recordFailure = resolve
  })
  const backups = startBackups({
    dbPath: f.dbPath,
    config: { dir: f.dir, keep: 2 },
    log(message) {
      messages.push(message)
      if (message.startsWith('backup FAILED')) recordFailure()
    },
    publisher: {
      ...durableSnapshotPublisher,
      syncFile() {
        throw new Error('disk unavailable')
      },
    },
  })
  try {
    await failed
    await backups.stop()
    assert.isTrue(messages.some((message) => message.includes('disk unavailable')))
  } finally {
    await backups.stop()
    f.cleanup()
  }
})

test('scheduler runs again after one fixed day', async ({ assert }) => {
  const f = fixture()
  let tick: (() => void) | undefined
  let intervalMs: number | undefined
  const written: string[] = []
  let notify: (() => void) | undefined
  let count = 0
  const reached = (target: number) =>
    new Promise<void>((resolve) => {
      if (count >= target) resolve()
      else notify = resolve
    })
  const backups = startBackups({
    dbPath: f.dbPath,
    config: { dir: f.dir, keep: 2 },
    schedule(callback, delay) {
      tick = callback
      intervalMs = delay
      return () => {}
    },
    log(message) {
      const match = /^backup written (\S+)/.exec(message)
      if (match?.[1]) {
        written.push(match[1])
        count++
        notify?.()
        notify = undefined
      }
    },
  })
  try {
    await reached(1)
    await backups.snapshotNow()
    assert.equal(intervalMs, 24 * 60 * 60_000)
    tick!()
    await reached(2)
    assert.equal(written.length, 2)
    assert.notEqual(written[0], written[1])
  } finally {
    await backups.stop()
    f.cleanup()
  }
})

test('db:backup applies the configured retention limit', ({ assert, test: testCase }) => {
  testCase.timeout(30_000)
  const f = fixture()
  try {
    rmSync(f.dbPath)
    const env = {
      ...process.env,
      CAPACITYLENS_DB: f.dbPath,
      CAPACITYLENS_BACKUP_DIR: f.dir,
      CAPACITYLENS_BACKUP_KEEP: '1',
      APP_KEY: 'zKXHe-Ahdb7aPK1ylAJlRgTefktEaACi',
      APP_URL: 'http://127.0.0.1',
      SESSION_DRIVER: 'cookie',
      HOST: '127.0.0.1',
      PORT: '0',
      LOG_LEVEL: 'info',
      NODE_ENV: 'test',
      CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION: '1',
      CAPACITYLENS_AUDIT: 'on',
      CAPACITYLENS_ALLOW_RESET: 'false',
      CAPACITYLENS_CREATE_ADMIN_ADMIN: 'false',
      CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: '',
      CAPACITYLENS_MODE: 'off',
    }
    const upgrade = spawnSync(process.execPath, ['ace.js', 'app:upgrade'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 25_000,
      env,
    })
    assert.equal(upgrade.status, 0, `${upgrade.stdout}\n${upgrade.stderr}`)
    ensurePrivateBackupDirectory(f.dir)
    for (const name of [
      'capacitylens-utc-20200101-000000-000.db',
      'capacitylens-utc-20200102-000000-000.db',
    ])
      writeFileSync(join(f.dir, name), 'old snapshot')
    const result = spawnSync(process.execPath, ['ace.js', 'db:backup'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 25_000,
      env,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.lengthOf(
      readdirSync(f.dir).filter((name) => /^capacitylens-.*\.db$/.test(name)),
      1
    )
  } finally {
    f.cleanup()
  }
})

test('snapshot rejects live database aliases and never publishes an unverified copy', async ({
  assert,
}) => {
  const f = fixture()
  try {
    const database = openNativeDatabase(f.dbPath)
    const alias = join(f.root, 'capacitylens-utc-20200101-000000-000.db')
    linkSync(f.dbPath, alias)
    await assert.rejects(
      () => writeOneShotSnapshot({ database, dir: f.root, file: alias }),
      /live SQLite database/
    )
    database.close()
    assert.isTrue(existsSync(alias))
  } finally {
    f.cleanup()
  }
})

test('repeated and backwards clocks preserve unique snapshot names across restarts', async ({
  assert,
}) => {
  const f = fixture()
  try {
    const input = {
      dbPath: f.dbPath,
      config: { dir: f.dir, keep: 10 },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      log: () => {},
    }
    const first = startBackups(input)
    const a = await first.snapshotNow()
    const b = await first.snapshotNow()
    await first.stop()
    const second = startBackups(input)
    const c = await second.snapshotNow()
    await second.stop()
    assert.notEqual(a, b)
    assert.notEqual(b, c)
    assert.isTrue(existsSync(a))
    assert.isTrue(existsSync(b))
    assert.isTrue(existsSync(c))
  } finally {
    f.cleanup()
  }
})

test('failed publication retains existing restore points and a later retry succeeds', async ({
  assert,
}) => {
  const f = fixture()
  try {
    let fail = false
    const backups = startBackups({
      dbPath: f.dbPath,
      config: { dir: f.dir, keep: 1 },
      log: () => {},
      publisher: {
        ...durableSnapshotPublisher,
        syncFile(path) {
          if (fail) {
            fail = false
            throw new Error('sync failed')
          }
          durableSnapshotPublisher.syncFile(path)
        },
      },
    })
    const previous = await backups.snapshotNow()
    fail = true
    await assert.rejects(() => backups.snapshotNow(), /sync failed/)
    assert.isTrue(existsSync(previous))
    const file = await backups.snapshotNow()
    assert.isTrue(existsSync(file))
    assert.equal(readdirSync(f.dir).filter((name) => name.endsWith('.db')).length, 1)
    await backups.stop()
  } finally {
    f.cleanup()
  }
})

test('stop drains accepted snapshots and rejects new work', async ({ assert }) => {
  const f = fixture()
  try {
    const backups = startBackups({
      dbPath: f.dbPath,
      config: { dir: f.dir, keep: 10 },
      log: () => {},
    })
    const accepted = [backups.snapshotNow(), backups.snapshotNow()]
    assert.isTrue(accepted[0] === accepted[1])
    const stopped = backups.stop()
    await assert.rejects(() => backups.snapshotNow(), /stopped/)
    const files = await Promise.all(accepted)
    await stopped
    assert.isTrue(files.every(existsSync))
  } finally {
    f.cleanup()
  }
})

test('backup source follows resolved database configuration and rejects memory databases', ({
  assert,
}) => {
  const configured = {
    connection: 'sqlite',
    connections: { sqlite: { connection: { filename: '/tmp/configured.db' } } },
  }
  const oldEnvironment = process.env.CAPACITYLENS_DB
  process.env.CAPACITYLENS_DB = '/tmp/different-env.db'
  try {
    assert.equal(resolveBackupDatabasePath(configured), '/tmp/configured.db')
    assert.throws(
      () =>
        resolveBackupDatabasePath({
          connection: 'sqlite',
          connections: { sqlite: { connection: { filename: ':memory:' } } },
        }),
      /file-backed/
    )
    assert.throws(
      () =>
        startBackups({
          dbPath: ':memory:',
          config: { dir: '/tmp/unused', keep: 1 },
        }),
      /file-backed/
    )
  } finally {
    if (oldEnvironment === undefined) delete process.env.CAPACITYLENS_DB
    else process.env.CAPACITYLENS_DB = oldEnvironment
  }
})

test('disappeared backup destination fails without recreating the destination', async ({
  assert,
}) => {
  const f = fixture()
  try {
    const backups = startBackups({
      dbPath: f.dbPath,
      config: { dir: f.dir, keep: 2 },
      log: () => {},
    })
    await backups.snapshotNow()
    rmSync(f.dir, { recursive: true, force: true })
    await assert.rejects(() => backups.snapshotNow())
    assert.isFalse(existsSync(f.dir))
    await backups.stop()
  } finally {
    f.cleanup()
  }
})

test('foreign-key-invalid source refuses a copy and preserves a previous rollback file', async ({
  assert,
}) => {
  const f = fixture()
  try {
    ensurePrivateBackupDirectory(f.dir)
    const live = openNativeDatabase(f.dbPath)
    const file = join(f.dir, 'rollback.db')
    await writeOneShotSnapshot({ database: live, dir: f.dir, file })
    const previous = readFileSync(file)
    live.prepare('CREATE TABLE parents (id INTEGER PRIMARY KEY)').run()
    live.prepare('CREATE TABLE children (parent_id INTEGER REFERENCES parents(id))').run()
    live.pragma('foreign_keys = OFF')
    live.prepare('INSERT INTO children(parent_id) VALUES (999)').run()
    await assert.rejects(
      () => writeOneShotSnapshot({ database: live, dir: f.dir, file }),
      /foreign_key_check/
    )
    assert.deepEqual(readFileSync(file), previous)
    live.close()
  } finally {
    f.cleanup()
  }
})

test('scheduled publication refuses an occupied final name without replacing it', async ({
  assert,
}) => {
  const f = fixture()
  try {
    const stamp = new Date('2026-01-01T00:00:00.000Z')
    let occupied: string | undefined
    const backups = startBackups({
      dbPath: f.dbPath,
      config: { dir: f.dir, keep: 10 },
      now: () => stamp,
      log: () => {},
      publisher: {
        ...durableSnapshotPublisher,
        syncFile(path) {
          occupied = path.replace(/\.\d+-\d+\.tmp$/, '')
          writeFileSync(occupied, 'occupied', { flag: 'wx' })
          durableSnapshotPublisher.syncFile(path)
        },
      },
    })
    await assert.rejects(() => backups.snapshotNow())
    assert.equal(readFileSync(occupied!, 'utf8'), 'occupied')
    await backups.stop()
  } finally {
    f.cleanup()
  }
})

test('retention preserves live database hard-link aliases', async ({ assert }) => {
  const f = fixture()
  try {
    ensurePrivateBackupDirectory(f.dir)
    const alias = join(f.dir, 'capacitylens-utc-20200101-000000-000.db')
    const symlinkAlias = join(f.dir, 'capacitylens-utc-20200101-000000-001.db')
    const directory = join(f.dir, 'capacitylens-utc-20200101-000000-002.db')
    const oldSnapshot = join(f.dir, 'capacitylens-utc-20200101-000000-003.db')
    const unrelated = join(f.dir, 'other.db')
    linkSync(f.dbPath, alias)
    symlinkSync(f.dbPath, symlinkAlias)
    mkdirSync(directory)
    writeFileSync(oldSnapshot, 'old snapshot')
    writeFileSync(unrelated, 'unrelated')
    const backups = startBackups({
      dbPath: f.dbPath,
      config: { dir: f.dir, keep: 1 },
      log: () => {},
    })
    await backups.snapshotNow()
    await backups.snapshotNow()
    assert.isTrue(existsSync(alias))
    assert.isTrue(existsSync(symlinkAlias))
    assert.isTrue(existsSync(directory))
    assert.isFalse(existsSync(oldSnapshot))
    assert.isTrue(existsSync(unrelated))
    await backups.stop()
  } finally {
    f.cleanup()
  }
})
