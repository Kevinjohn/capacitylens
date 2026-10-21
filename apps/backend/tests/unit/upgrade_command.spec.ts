import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openNativeDatabase } from '#services/backup/native'

const appRoot = process.cwd()
const hash = (source: string) => createHash('sha256').update(source).digest('hex')

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
    assert.lengthOf(journal(dbPath), 10)
    assert.isFalse(result.output.includes('Pre-upgrade backup written'))
    const repeated = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(repeated.status, 0, repeated.output)
    assert.match(repeated.output, /Already up to date/)
    assert.isFalse(repeated.output.includes('Pre-upgrade backup written'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('native upgrade backs up a known partial journal and refuses a failed backup', ({
  assert,
  test: testCase,
}) => {
  testCase.timeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-upgrade-partial-'))
  try {
    const dbPath = join(root, 'live.db')
    const init = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(init.status, 0, init.output)
    const rollback = command(appRoot, dbPath, [
      'ace.js',
      'migration:rollback',
      '--step=9',
      '--force',
      '--no-schema-generate',
    ])
    assert.equal(rollback.status, 0, rollback.output)
    assert.lengthOf(journal(dbPath), 1)

    const blockedDir = join(root, 'occupied')
    writeFileSync(blockedDir, 'not a directory')
    const blocked = ace(appRoot, dbPath, 'app:upgrade', blockedDir)
    assert.notEqual(blocked.status, 0, blocked.output)
    assert.isNotNull(blocked.status, blocked.output)
    assert.lengthOf(journal(dbPath), 1)

    const upgrade = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(upgrade.status, 0, upgrade.output)
    assert.lengthOf(journal(dbPath), 10)
    const snapshot = join(root, 'live.db.backups/capacitylens-pre-migration-v1-to-v10.db')
    assert.lengthOf(journal(snapshot), 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('upgrade refuses old journal metadata and schema drift on an otherwise complete database', ({
  assert,
  test: testCase,
}) => {
  testCase.timeout(40_000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-upgrade-metadata-'))
  try {
    const dbPath = join(root, 'live.db')
    const init = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(init.status, 0, init.output)
    const database = openNativeDatabase(dbPath)
    database.prepare('UPDATE adonis_schema_versions SET version = 1').run()
    database.close()
    const oldVersion = ace(appRoot, dbPath, 'app:upgrade')
    assert.isNotNull(oldVersion.status, oldVersion.output)
    assert.notEqual(oldVersion.status, 0, oldVersion.output)
    assert.match(oldVersion.output, /Migration journal version is invalid/)
    assert.isFalse(existsSync(`${dbPath}.backups`))
    const restoreVersion = openNativeDatabase(dbPath)
    restoreVersion.prepare('UPDATE adonis_schema_versions SET version = 2').run()
    restoreVersion.prepare('DROP TRIGGER clients_account_immutable').run()
    restoreVersion.close()
    const drift = ace(appRoot, dbPath, 'app:upgrade')
    assert.isNotNull(drift.status, drift.output)
    assert.notEqual(drift.status, 0, drift.output)
    assert.match(drift.output, /Database schema drift/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('unknown and unjournaled SQLite histories fail every native entry point', ({
  assert,
  test: testCase,
}) => {
  testCase.timeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-unknown-journal-'))
  try {
    const dbPath = join(root, 'unknown.db')
    const database = openNativeDatabase(dbPath)
    database
      .prepare('CREATE TABLE adonis_schema (id INTEGER PRIMARY KEY, name TEXT, batch INTEGER)')
      .run()
    database.prepare('CREATE TABLE adonis_schema_versions (version INTEGER PRIMARY KEY)').run()
    database.prepare('INSERT INTO adonis_schema_versions(version) VALUES (2)').run()
    database
      .prepare("INSERT INTO adonis_schema(name, batch) VALUES ('database/migrations/unknown', 1)")
      .run()
    database.close()
    for (const args of [
      ['ace.js', 'app:upgrade'],
      ['ace.js', 'migration:run', '--force', '--no-schema-generate'],
      ['--import=@poppinss/ts-exec', 'bin/server.ts'],
    ]) {
      const result = command(appRoot, dbPath, args)
      assert.notEqual(result.status, 0, result.output)
      assert.isNotNull(result.status, result.output)
      assert.match(result.output, /Migration journal is inconsistent/)
      if (args.includes('bin/server.ts')) {
        assert.notMatch(result.output, /started HTTP server/)
      }
    }

    const unjournaledPath = join(root, 'unjournaled.db')
    const unjournaled = openNativeDatabase(unjournaledPath)
    unjournaled.prepare('CREATE TABLE sqliteXdata (id TEXT PRIMARY KEY)').run()
    unjournaled.close()
    for (const args of [
      ['ace.js', 'app:upgrade'],
      ['--import=@poppinss/ts-exec', 'bin/server.ts'],
    ]) {
      const result = command(appRoot, unjournaledPath, args)
      assert.notEqual(result.status, 0, result.output)
      assert.isNotNull(result.status, result.output)
      assert.match(result.output, /Database schema has no migration journal/)
      if (args.includes('bin/server.ts')) {
        assert.notMatch(result.output, /started HTTP server/)
      }
    }
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

    const scratch = join(root, 'backend')
    cpSync(appRoot, scratch, {
      recursive: true,
      filter: (path) => !path.endsWith('/node_modules') && !path.endsWith('/build'),
    })
    symlinkSync(join(appRoot, 'node_modules'), join(scratch, 'node_modules'), 'dir')
    const first = 'database/migrations/202610200002_commit_before_failure'
    const second = 'database/migrations/202610200003_fail_after_ddl'
    const committedSource = `import { BaseSchema } from '@adonisjs/lucid/schema'\nexport default class extends BaseSchema { async up() { this.schema.createTable('upgrade_committed', (table) => table.increments('id')) } async down() { this.schema.dropTable('upgrade_committed') } }\n`
    const failedSource = `import { BaseSchema } from '@adonisjs/lucid/schema'\nexport default class extends BaseSchema { async up() { this.schema.createTable('upgrade_rolled_back', (table) => table.increments('id')); await this.schema.raw('SELECT * FROM table_that_does_not_exist') } async down() { this.schema.dropTable('upgrade_rolled_back') } }\n`
    writeFileSync(join(scratch, `${first}.ts`), committedSource)
    writeFileSync(join(scratch, `${second}.ts`), failedSource)
    const manifestPath = join(scratch, 'database/released.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: number
      migrations: Array<{ name: string; sha256: string }>
    }
    manifest.migrations.push(
      { name: first, sha256: hash(committedSource) },
      { name: second, sha256: hash(failedSource) }
    )
    writeFileSync(manifestPath, JSON.stringify(manifest))

    const upgrade = ace(scratch, dbPath, 'app:upgrade')
    assert.notEqual(upgrade.status, 0, upgrade.output)
    assert.lengthOf(journal(dbPath), 11)
    const database = openNativeDatabase(dbPath, { readonly: true, fileMustExist: true })
    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
      assert.include(
        tables.map(({ name }) => name),
        'upgrade_committed'
      )
      assert.notInclude(
        tables.map(({ name }) => name),
        'upgrade_rolled_back'
      )
    } finally {
      database.close()
    }
    const snapshot = join(root, 'live.db.backups/capacitylens-pre-migration-v10-to-v12.db')
    assert.lengthOf(journal(snapshot), 10)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the eighth migration preserves legacy identities and proofs without promoting email changes', ({
  assert,
  test: testCase,
}) => {
  testCase.timeout(60000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-token-upgrade-'))
  try {
    const dbPath = join(root, 'live.db')
    const init = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(init.status, 0, init.output)
    const rollback = command(appRoot, dbPath, [
      'ace.js',
      'migration:rollback',
      '--step=3',
      '--force',
      '--no-schema-generate',
    ])
    assert.equal(rollback.status, 0, rollback.output)
    assert.lengthOf(journal(dbPath), 7)
    const legacy = new DatabaseSync(dbPath)
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 3600000).toISOString()
    const proof = Buffer.alloc(32, 7).toString('base64url')
    assert.lengthOf(proof, 43)
    for (const [id, verified] of [
      ['bruce', 1],
      ['clark', 0],
    ] as const)
      legacy
        .prepare(
          'INSERT INTO users (id,email,password_hash,email_verified,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(id, `${id}@wayne.example`, 'legacy-credential', verified, 'Bruce Wayne', now, now)
    legacy
      .prepare(
        'INSERT INTO account_recovery_tokens (id,user_id,email,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)'
      )
      .run(19, 'bruce', 'bruce@wayne.example', hash(proof), expires, now)
    legacy
      .prepare(
        'INSERT INTO account_recovery_tokens (id,user_id,email,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)'
      )
      .run(20, 'clark', 'clark@wayne.example', hash('expired-proof'), now, now)
    legacy
      .prepare(
        'INSERT INTO account_email_changes (id,user_id,current_email,new_email,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?,?)'
      )
      .run(
        21,
        'clark',
        'clark@wayne.example',
        'kal@wayne.example',
        hash('unknown-legacy-proof'),
        expires,
        now
      )
    const users = legacy.prepare('SELECT * FROM users ORDER BY id').all()
    const changes = legacy.prepare('SELECT * FROM account_email_changes').all()
    const tokens = legacy
      .prepare(
        'SELECT id,user_id AS tokenable_id,email,token_hash AS hash,expires_at,created_at FROM account_recovery_tokens ORDER BY id'
      )
      .all()
    legacy.close()
    const upgrade = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(upgrade.status, 0, upgrade.output)
    assert.lengthOf(journal(dbPath), 10)
    const current = new DatabaseSync(dbPath)
    current.exec('PRAGMA foreign_keys = ON')
    assert.deepEqual(current.prepare('SELECT * FROM users ORDER BY id').all(), users)
    assert.deepEqual(current.prepare('SELECT * FROM account_email_changes').all(), changes)
    assert.deepEqual(
      current.prepare('SELECT * FROM password_reset_tokens ORDER BY id').all(),
      tokens
    )
    assert.equal(current.prepare('SELECT COUNT(*) AS n FROM email_verification_tokens').get()!.n, 0)
    assert.equal(
      current.prepare('SELECT COUNT(*) AS n FROM account_transaction_lock WHERE id=1').get()!.n,
      1
    )
    assert.throws(
      () =>
        current
          .prepare(
            'INSERT INTO password_reset_tokens (tokenable_id,email,hash,expires_at,created_at) VALUES (?,?,?,?,?)'
          )
          .run('bruce', 'bruce@wayne.example', hash('another'), expires, now),
      /UNIQUE/
    )
    assert.throws(
      () =>
        current
          .prepare(
            'INSERT INTO password_reset_tokens (tokenable_id,email,hash,expires_at,created_at) VALUES (?,?,?,?,?)'
          )
          .run('missing', 'missing@wayne.example', hash(proof), expires, now),
      /UNIQUE|FOREIGN KEY/
    )
    const verification = current.prepare(
      'INSERT INTO email_verification_tokens (tokenable_id,email,hash,expires_at,created_at) VALUES (?,?,?,?,?)'
    )
    verification.run('bruce', 'bruce@wayne.example', hash('activation-proof'), expires, now)
    assert.throws(
      () => verification.run('bruce', 'bruce@wayne.example', hash('replacement'), expires, now),
      /UNIQUE/
    )
    assert.throws(
      () =>
        verification.run('clark', 'clark@wayne.example', hash('activation-proof'), expires, now),
      /UNIQUE/
    )
    assert.throws(
      () => verification.run('missing', 'missing@wayne.example', hash('orphan'), expires, now),
      /FOREIGN KEY/
    )
    current.prepare("DELETE FROM users WHERE id='bruce'").run()
    assert.equal(
      current
        .prepare("SELECT COUNT(*) AS n FROM password_reset_tokens WHERE tokenable_id='bruce'")
        .get()!.n,
      0
    )
    assert.equal(current.prepare('SELECT COUNT(*) AS n FROM email_verification_tokens').get()!.n, 0)
    current.close()
    const reopen = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(reopen.status, 0, reopen.output)
    assert.match(reopen.output, /Already up to date/)
    const snapshot = join(root, 'live.db.backups/capacitylens-pre-migration-v7-to-v10.db')
    assert.lengthOf(journal(snapshot), 7)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the ninth migration preserves identities and existing proofs while adding inert login-link storage', ({
  assert,
  test: testCase,
}) => {
  testCase.timeout(60000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-login-link-upgrade-'))
  try {
    const dbPath = join(root, 'live.db')
    const init = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(init.status, 0, init.output)
    const rollback = command(appRoot, dbPath, [
      'ace.js',
      'migration:rollback',
      '--step=2',
      '--force',
      '--no-schema-generate',
    ])
    assert.equal(rollback.status, 0, rollback.output)
    assert.lengthOf(journal(dbPath), 8)
    const legacy = new DatabaseSync(dbPath)
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 3600000).toISOString()
    for (const id of ['bruce', 'clark']) {
      legacy
        .prepare(
          'INSERT INTO users (id,email,password_hash,email_verified,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(id, `${id}@wayne.example`, 'existing-credential', 1, 'Bruce Wayne', now, now)
      legacy
        .prepare(
          'INSERT INTO password_reset_tokens (tokenable_id,email,hash,expires_at,created_at) VALUES (?,?,?,?,?)'
        )
        .run(id, `${id}@wayne.example`, hash(id), expires, now)
      legacy
        .prepare(
          'INSERT INTO email_verification_tokens (tokenable_id,email,hash,expires_at,created_at) VALUES (?,?,?,?,?)'
        )
        .run(id, `${id}@wayne.example`, hash(`verify-${id}`), expires, now)
    }
    const preserved = [
      'users',
      'password_reset_tokens',
      'email_verification_tokens',
      'account_email_changes',
      'account_transaction_lock',
    ]
    const before = preserved.map((table) =>
      legacy.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    )
    legacy.close()
    const blockedDir = join(root, 'occupied')
    writeFileSync(blockedDir, 'not a directory')
    const blocked = ace(appRoot, dbPath, 'app:upgrade', blockedDir)
    assert.notEqual(blocked.status, 0, blocked.output)
    assert.lengthOf(journal(dbPath), 8)
    const upgrade = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(upgrade.status, 0, upgrade.output)
    assert.lengthOf(journal(dbPath), 10)
    const current = new DatabaseSync(dbPath)
    try {
      current.exec('PRAGMA foreign_keys = ON')
      assert.deepEqual(
        preserved.map((table) => current.prepare(`SELECT * FROM ${table} ORDER BY id`).all()),
        before
      )
      const insert = current.prepare(
        'INSERT INTO login_link_tokens (tokenable_id,email,hash,client_challenge,expires_at,created_at) VALUES (?,?,?,?,?,?)'
      )
      insert.run('bruce', 'bruce@wayne.example', hash('login-proof'), 'a'.repeat(43), expires, now)
      assert.throws(
        () =>
          insert.run('bruce', 'bruce@wayne.example', hash('another'), 'a'.repeat(43), expires, now),
        /UNIQUE/
      )
      assert.throws(
        () =>
          insert.run(
            'clark',
            'clark@wayne.example',
            hash('login-proof'),
            'a'.repeat(43),
            expires,
            now
          ),
        /UNIQUE/
      )
      assert.throws(
        () =>
          insert.run(
            'missing',
            'missing@wayne.example',
            hash('orphan'),
            'a'.repeat(43),
            expires,
            now
          ),
        /FOREIGN KEY/
      )
      assert.throws(
        () =>
          insert.run(
            null,
            'missing@wayne.example',
            hash('null-user'),
            'a'.repeat(43),
            expires,
            now
          ),
        /NOT NULL/
      )
      current.prepare("DELETE FROM users WHERE id='bruce'").run()
      assert.equal(current.prepare('SELECT COUNT(*) AS n FROM login_link_tokens').get()!.n, 0)
      assert.equal(
        current
          .prepare("SELECT COUNT(*) AS n FROM password_reset_tokens WHERE tokenable_id='clark'")
          .get()!.n,
        1
      )
    } finally {
      current.close()
    }
    const reopen = ace(appRoot, dbPath, 'app:upgrade')
    assert.equal(reopen.status, 0, reopen.output)
    assert.match(reopen.output, /Already up to date/)
    const snapshot = join(root, 'live.db.backups/capacitylens-pre-migration-v8-to-v10.db')
    assert.lengthOf(journal(snapshot), 8)
    const backup = new DatabaseSync(snapshot, { readOnly: true })
    try {
      assert.deepEqual(
        preserved.map((table) => backup.prepare(`SELECT * FROM ${table} ORDER BY id`).all()),
        before
      )
    } finally {
      backup.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
