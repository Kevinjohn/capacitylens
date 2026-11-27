import { test } from '@japa/runner'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error better-sqlite3 does not publish declarations
import Database from 'better-sqlite3'
import {
  createBundle,
  listBundles,
  preMigrationBackupDirectory,
  prepareDirectory,
  verifyBundle,
} from '@kevinjohn/adonisjs-sqlite-backup'
import { assertSafeFailure } from '#tests/helpers/operator_command_helpers'
import {
  ace,
  appRoot,
  journal,
  preMigrationBackups,
  scratchApp,
  shipped,
  tables,
} from '#tests/helpers/unit/upgrade_command'

test.group('upgrade command', () => {
  test('native upgrade initializes a fresh database without a backup', ({
    assert,
    test: testCase,
  }) => {
    testCase.timeout(40_000)
    const root = mkdtempSync(join(tmpdir(), 'capacitylens-upgrade-fresh-'))
    try {
      const dbPath = join(root, 'live.db')
      const result = ace(appRoot, dbPath, 'app:upgrade')
      assert.equal(result.status, 0, result.output)
      assert.lengthOf(journal(dbPath), shipped)
      assert.isFalse(result.output.includes('Pre-upgrade backup written'))
      const repeated = ace(appRoot, dbPath, 'app:upgrade')
      assert.equal(repeated.status, 0, repeated.output)
      assert.match(repeated.output, /Already up to date/)
      assert.lengthOf(journal(dbPath), shipped)
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
        '209912310001_add_upgrade_table': `import { BaseSchema } from '@adonisjs/lucid/schema'\nexport default class extends BaseSchema { async up() { this.schema.createTable('upgrade_added', (table) => table.increments('id')) } }\n`,
      })

      const blockedDir = join(root, 'occupied')
      writeFileSync(blockedDir, 'not a directory')
      const blocked = ace(scratch, dbPath, 'app:upgrade', blockedDir)
      assertSafeFailure(assert, blocked, /Upgrade failed/)
      assert.lengthOf(journal(dbPath), shipped)
      assert.notInclude(tables(dbPath), 'upgrade_added')

      const upgrade = ace(scratch, dbPath, 'app:upgrade')
      assert.equal(upgrade.status, 0, upgrade.output)
      assert.match(upgrade.output, /Pre-upgrade backup written/)
      assert.lengthOf(journal(dbPath), shipped + 1)
      assert.include(tables(dbPath), 'upgrade_added')
      const backups = join(root, 'live.db.backups')
      const [backup, ...others] = preMigrationBackups(backups)
      assert.isDefined(backup)
      assert.lengthOf(others, 0)
      assert.lengthOf(journal(join(backups, backup!, 'db.sqlite')), shipped)
      assert.notInclude(tables(join(backups, backup!, 'db.sqlite')), 'upgrade_added')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('upgrade refuses a database missing a shipped migration record', ({
    assert,
    test: testCase,
  }) => {
    testCase.timeout(40_000)
    const root = mkdtempSync(join(tmpdir(), 'capacitylens-upgrade-drift-'))
    try {
      const dbPath = join(root, 'live.db')
      const init = ace(appRoot, dbPath, 'app:upgrade')
      assert.equal(init.status, 0, init.output)
      const database = new Database(dbPath)
      database.prepare('DELETE FROM adonis_schema').run()
      database.close()
      const drift = ace(appRoot, dbPath, 'app:upgrade')
      assert.equal(drift.status, 1, drift.output)
      assert.lengthOf(journal(dbPath), 0)
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
        '209912310001_commit_before_failure': `import { BaseSchema } from '@adonisjs/lucid/schema'\nexport default class extends BaseSchema { async up() { this.schema.createTable('upgrade_committed', (table) => table.increments('id')) } }\n`,
        '209912310002_fail_after_ddl': `import { BaseSchema } from '@adonisjs/lucid/schema'\nexport default class extends BaseSchema { async up() { this.schema.createTable('upgrade_rolled_back', (table) => table.increments('id')); this.schema.raw('SELECT * FROM table_that_does_not_exist') } }\n`,
      })

      const upgrade = ace(scratch, dbPath, 'app:upgrade')
      assertSafeFailure(assert, upgrade, /Upgrade failed: .*table_that_does_not_exist/)
      assert.lengthOf(journal(dbPath), shipped + 1)
      assert.include(tables(dbPath), 'upgrade_committed')
      assert.notInclude(tables(dbPath), 'upgrade_rolled_back')
      const [backup] = preMigrationBackups(join(root, 'live.db.backups'))
      assert.isDefined(backup)
      assert.lengthOf(journal(join(root, 'live.db.backups', backup!, 'db.sqlite')), shipped)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('upgrade fallback creates a private backup directory without changing its parent', async ({
    assert,
  }) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'capacitylens-upgrade-')))
    try {
      const databasePath = join(root, 'live.db')
      const database = new Database(databasePath)
      try {
        database.prepare('CREATE TABLE entries (id INTEGER PRIMARY KEY)').run()
        const parent = await stat(root)
        const parentMode = parent.mode & 0o777
        const dir = preMigrationBackupDirectory(databasePath)
        prepareDirectory(dir)
        const bundle = await createBundle({ source: { database }, directory: dir })
        const file = join(bundle.path, 'db.sqlite')
        assert.equal(verifyBundle(dir, bundle.name).path, bundle.path)
        const afterParent = await stat(root)
        const backupDirectory = await stat(dir)
        const backupFile = await stat(file)
        assert.equal(afterParent.mode & 0o777, parentMode)
        assert.equal(backupDirectory.mode & 0o777, 0o700)
        assert.equal(backupFile.mode & 0o777, 0o400)
        assert.equal(
          preMigrationBackupDirectory(databasePath, join(root, 'configured')),
          join(root, 'configured', 'pre-migration')
        )
      } finally {
        database.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('upgrade prepares the configured pre-migration destination on first use', ({
    assert,
    test: t,
  }) => {
    t.timeout(60_000)
    const root = mkdtempSync(join(tmpdir(), 'capacitylens-upgrade-configured-'))
    try {
      const live = join(root, 'live.db')
      assert.equal(ace(appRoot, live, 'app:upgrade').status, 0)
      const directory = join(root, 'scheduled')
      const upgrade = ace(appRoot, live, 'app:upgrade', directory)
      assert.equal(upgrade.status, 0, upgrade.output)
      assert.deepEqual(listBundles(directory), [])
      const actual = join(directory, 'pre-migration')
      const bundles = listBundles(actual)
      assert.lengthOf(bundles, 1)
      assert.equal(verifyBundle(actual, bundles[0]!.name).path, bundles[0]!.path)
      assert.lengthOf(journal(join(bundles[0]!.path, 'db.sqlite')), shipped)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
