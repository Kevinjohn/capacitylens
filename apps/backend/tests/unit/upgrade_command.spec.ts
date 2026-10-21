import { test } from '@japa/runner'
import { cpSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openNativeDatabase } from '#services/backup/native'
import { ensurePrivateBackupDirectory, writeOneShotSnapshot } from '#services/backup/snapshot'
import { preMigrationBackupDirectory } from '../../commands/app_upgrade.js'

const appRoot = process.cwd()

function command(root: string, databasePath: string, args: string[], backupDir?: string) {
  const web = args.includes('bin/server.ts')
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: web ? 8_000 : 25_000,
    env: {
      ...process.env,
      CAPACITYLENS_DB: databasePath,
      CAPACITYLENS_BACKUP_DIR: backupDir ?? '',
      APP_KEY: 'zKXHe-Ahdb7aPK1ylAJlRgTefktEaACi',
      APP_URL: 'http://127.0.0.1',
      SESSION_DRIVER: 'cookie',
      HOST: '127.0.0.1',
      PORT: '0',
      LOG_LEVEL: 'info',
      NODE_ENV: web ? 'production' : 'test',
      CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION: '1',
      CAPACITYLENS_AUDIT: 'on',
      CAPACITYLENS_ALLOW_RESET: 'false',
      CAPACITYLENS_CREATE_ADMIN_ADMIN: 'false',
      CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: '',
      CAPACITYLENS_MODE: 'off',
    },
  })
  if (child.error) throw child.error
  return { status: child.status, output: `${child.stdout}\n${child.stderr}` }
}

const ace = (root: string, databasePath: string, name: string, backupDir?: string) =>
  command(root, databasePath, ['ace.js', name], backupDir)

function journal(databasePath: string) {
  const database = openNativeDatabase(databasePath, { readonly: true, fileMustExist: true })
  try {
    return database.prepare('SELECT name FROM adonis_schema ORDER BY id').all() as Array<{
      name: string
    }>
  } finally {
    database.close()
  }
}

function tables(databasePath: string) {
  const database = openNativeDatabase(databasePath, { readonly: true, fileMustExist: true })
  try {
    return (
      database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string
      }>
    ).map(({ name }) => name)
  } finally {
    database.close()
  }
}

/** Copy the backend so a test can add pending migrations after the baseline. */
function scratchApp(root: string, migrations: Record<string, string>) {
  const scratch = join(root, 'backend')
  cpSync(appRoot, scratch, {
    recursive: true,
    filter: (path) => !path.endsWith('/node_modules') && !path.endsWith('/build'),
  })
  symlinkSync(join(appRoot, 'node_modules'), join(scratch, 'node_modules'), 'dir')
  for (const [name, source] of Object.entries(migrations))
    writeFileSync(join(scratch, `database/migrations/${name}.ts`), source)
  return scratch
}

function preMigrationSnapshots(dir: string) {
  return readdirSync(dir).filter((name) => /^capacitylens-pre-migration-utc-[\d-]+\.db$/.test(name))
}

test('native upgrade initializes a fresh database without a snapshot', ({
  assert,
  test: testCase,
}) => {
  testCase.timeout(40_000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-upgrade-fresh-'))
  try {
    const dbPath = join(root, 'live.db')
    const result = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(result.status, 0, result.output)
    assert.lengthOf(journal(dbPath), 1)
    assert.isFalse(result.output.includes('Pre-upgrade backup written'))
    const repeated = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(repeated.status, 0, repeated.output)
    assert.match(repeated.output, /Already up to date/)
    assert.lengthOf(journal(dbPath), 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('native upgrade backs up an existing database before migrating and refuses a failed backup', ({
  assert,
  test: testCase,
}) => {
  testCase.timeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-upgrade-pending-'))
  try {
    const dbPath = join(root, 'live.db')
    const init = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(init.status, 0, init.output)
    const scratch = scratchApp(root, {
      '202610210001_add_upgrade_table': `import { BaseSchema } from '@adonisjs/lucid/schema'\nexport default class extends BaseSchema { async up() { this.schema.createTable('upgrade_added', (table) => table.increments('id')) } }\n`,
    })

    const blockedDir = join(root, 'occupied')
    writeFileSync(blockedDir, 'not a directory')
    const blocked = ace(scratch, dbPath, 'app:upgrade', blockedDir)
    assert.notEqual(blocked.status, 0, blocked.output)
    assert.isNotNull(blocked.status, blocked.output)
    assert.lengthOf(journal(dbPath), 1)
    assert.notInclude(tables(dbPath), 'upgrade_added')

    const upgrade = ace(scratch, dbPath, 'app:upgrade')
    assert.equal(upgrade.status, 0, upgrade.output)
    assert.match(upgrade.output, /Pre-upgrade backup written/)
    assert.lengthOf(journal(dbPath), 2)
    assert.include(tables(dbPath), 'upgrade_added')
    const backups = join(root, 'live.db.backups')
    const [snapshot, ...others] = preMigrationSnapshots(backups)
    assert.isDefined(snapshot)
    assert.lengthOf(others, 0)
    assert.lengthOf(journal(join(backups, snapshot!)), 1)
    assert.notInclude(tables(join(backups, snapshot!)), 'upgrade_added')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('upgrade refuses schema drift on an otherwise complete database', ({
  assert,
  test: testCase,
}) => {
  testCase.timeout(40_000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-upgrade-drift-'))
  try {
    const dbPath = join(root, 'live.db')
    const init = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(init.status, 0, init.output)
    const database = openNativeDatabase(dbPath)
    database.prepare('DROP TRIGGER clients_account_immutable').run()
    database.close()
    const drift = ace(appRoot, dbPath, 'app:upgrade')
    assert.isNotNull(drift.status, drift.output)
    assert.notEqual(drift.status, 0, drift.output)
    assert.match(drift.output, /Database schema drift/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failing later migration rolls back its own DDL after an earlier file commits', ({
  assert,
  test: testCase,
}) => {
  testCase.timeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-upgrade-failure-'))
  try {
    const dbPath = join(root, 'live.db')
    const init = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(init.status, 0, init.output)
    const scratch = scratchApp(root, {
      '202610210001_commit_before_failure': `import { BaseSchema } from '@adonisjs/lucid/schema'\nexport default class extends BaseSchema { async up() { this.schema.createTable('upgrade_committed', (table) => table.increments('id')) } }\n`,
      '202610210002_fail_after_ddl': `import { BaseSchema } from '@adonisjs/lucid/schema'\nexport default class extends BaseSchema { async up() { this.schema.createTable('upgrade_rolled_back', (table) => table.increments('id')); await this.schema.raw('SELECT * FROM table_that_does_not_exist') } }\n`,
    })

    const upgrade = ace(scratch, dbPath, 'app:upgrade')
    assert.notEqual(upgrade.status, 0, upgrade.output)
    assert.lengthOf(journal(dbPath), 2)
    assert.include(tables(dbPath), 'upgrade_committed')
    assert.notInclude(tables(dbPath), 'upgrade_rolled_back')
    const [snapshot] = preMigrationSnapshots(join(root, 'live.db.backups'))
    assert.isDefined(snapshot)
    assert.lengthOf(journal(join(root, 'live.db.backups', snapshot!)), 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('upgrade fallback creates a private backup directory without changing its parent', async ({
  assert,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'capacitylens-upgrade-'))
  try {
    const databasePath = join(root, 'live.db')
    const database = openNativeDatabase(databasePath)
    try {
      database.prepare('CREATE TABLE entries (id INTEGER PRIMARY KEY)').run()
      const parent = await stat(root)
      const parentMode = parent.mode & 0o777
      const dir = preMigrationBackupDirectory(databasePath)
      const file = join(dir, 'capacitylens-pre-migration.db')
      ensurePrivateBackupDirectory(dir)
      await writeOneShotSnapshot({ database, dir, file })
      const afterParent = await stat(root)
      const backupDirectory = await stat(dir)
      const backupFile = await stat(file)
      assert.equal(afterParent.mode & 0o777, parentMode)
      assert.equal(backupDirectory.mode & 0o777, 0o700)
      assert.equal(backupFile.mode & 0o777, 0o600)
      assert.equal(
        preMigrationBackupDirectory(databasePath, join(root, 'configured')),
        join(root, 'configured')
      )
    } finally {
      database.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
