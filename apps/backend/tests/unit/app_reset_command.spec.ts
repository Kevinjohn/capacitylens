import { test } from '@japa/runner'
import { cpSync, existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { operatorFixture, seedOwner } from './operator_command_support.js'

function tableCount(database: DatabaseSync, table: string) {
  return database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n
}

test('app reset archives all account, joining and credential state and initializes a separate empty database', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const source = f.inspect()
    seedOwner(source)
    const now = new Date().toISOString()
    source
      .prepare(
        'INSERT INTO account_joining_policies (id,account_id,policy,approved_domains,created_at,updated_at) VALUES (?,?,?,?,?,?)'
      )
      .run('policy', 'a-studio', 'invitation_only', '[]', now, now)
    source.close()
    const destination = join(f.root, 'fresh.db')
    const reset = f.command(['app:reset', destination, '--confirm-server-stopped'])
    assert.equal(reset.status, 0, reset.output)
    const result = JSON.parse(reset.output.trim()) as {
      archivePath: string
      snapshotPath: string
      databasePath: string
    }
    assert.equal(result.databasePath, destination)
    assert.isFalse(existsSync(f.databasePath))
    for (const path of [result.archivePath, result.snapshotPath]) {
      const archived = new DatabaseSync(path, { readOnly: true })
      assert.equal(tableCount(archived, 'users'), 1)
      assert.equal(tableCount(archived, 'account_joining_policies'), 1)
      archived.close()
    }
    const fresh = new DatabaseSync(destination)
    for (const table of [
      'users',
      'accounts',
      'memberships',
      'account_joining_policies',
      'company_join_intents',
      'password_reset_tokens',
      'email_verification_tokens',
      'login_link_tokens',
      'user_session_index',
      'company_planning_revisions',
      'planning_mutations',
    ])
      assert.equal(tableCount(fresh, table), 0, table)
    assert.equal(tableCount(fresh, 'adonis_schema'), 10)
    fresh.close()
  } finally {
    f.cleanup()
  }
})

test('app reset refuses absent stop intent, occupied paths and sidecars without changing the source', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const destination = join(f.root, 'fresh.db')
    assert.notEqual(f.command(['app:reset', destination]).status, 0)
    writeFileSync(destination, 'operator file')
    assert.notEqual(f.command(['app:reset', destination, '--confirm-server-stopped']).status, 0)
    const sidecar = join(f.root, 'other.db')
    writeFileSync(`${sidecar}-wal`, 'operator sidecar')
    assert.notEqual(f.command(['app:reset', sidecar, '--confirm-server-stopped']).status, 0)
    assert.isTrue(existsSync(f.databasePath))
    assert.isFalse(readdirSync(f.root).some((name) => name.includes('archive')))
  } finally {
    f.cleanup()
  }
})

test('lock and unknown-history reset refusals preserve the source without reserving a destination', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const source = f.inspect()
    const destination = join(f.root, 'fresh.db')
    source.exec('BEGIN IMMEDIATE')
    const locked = f.command(['app:reset', destination, '--confirm-server-stopped'])
    assert.notEqual(locked.status, 0)
    source.exec('ROLLBACK')
    source
      .prepare(
        "UPDATE adonis_schema SET name='database/migrations/unknown' WHERE id=(SELECT MAX(id) FROM adonis_schema)"
      )
      .run()
    source.close()
    const unknown = f.command(['app:reset', destination, '--confirm-server-stopped'])
    assert.notEqual(unknown.status, 0)
    assert.match(unknown.output, /Migration journal is inconsistent/)
    assert.isTrue(existsSync(f.databasePath))
    assert.isFalse(existsSync(destination))
  } finally {
    f.cleanup()
  }
})

test('a replacement upgrade failure preserves the verified recovery files and names the partial destination', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const source = f.inspect()
    seedOwner(source)
    source.close()
    const scratch = join(f.root, 'backend')
    cpSync(process.cwd(), scratch, {
      recursive: true,
      filter: (path) => !path.endsWith('/node_modules') && !path.endsWith('/build'),
    })
    symlinkSync(join(process.cwd(), 'node_modules'), join(scratch, 'node_modules'), 'dir')
    const originalAce = readFileSync(join(scratch, 'ace.js'))
    writeFileSync(join(scratch, 'ace.original.js'), originalAce)
    writeFileSync(
      join(scratch, 'ace.js'),
      "if (process.argv[2] === 'app:upgrade') process.exit(44); await import('./ace.original.js');\n"
    )
    const destination = join(f.root, 'partial.db')
    const result = f.command(['app:reset', destination, '--confirm-server-stopped'], {}, scratch)
    assert.notEqual(result.status, 0)
    assert.include(result.output, 'new database upgrade')
    assert.include(result.output, destination)
    const archive = readdirSync(f.root).find((name) => name.includes('.reset-archive-'))!
    for (const file of ['original.db', 'snapshot.db']) {
      const saved = new DatabaseSync(join(f.root, archive, file), { readOnly: true })
      assert.equal(tableCount(saved, 'users'), 1)
      saved.close()
    }
    assert.isTrue(existsSync(destination))
    assert.isFalse(existsSync(f.databasePath))
  } finally {
    f.cleanup()
  }
})

test('a failed snapshot reports only completed recovery artifacts and leaves the source in place', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const source = f.inspect()
    seedOwner(source)
    source.exec('PRAGMA foreign_keys=OFF')
    source
      .prepare(
        'INSERT INTO memberships (id,account_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
      )
      .run(
        'orphan',
        'a-studio',
        'missing-user',
        'viewer',
        'active',
        new Date().toISOString(),
        new Date().toISOString()
      )
    source.close()
    const destination = join(f.root, 'fresh.db')
    const result = f.command(['app:reset', destination, '--confirm-server-stopped'])
    assert.notEqual(result.status, 0)
    assert.include(result.output, 'No verified snapshot was completed')
    assert.include(result.output, `Original source remains at: ${f.databasePath}`)
    assert.notInclude(result.output, 'Original archive:')
    assert.isTrue(existsSync(f.databasePath))
  } finally {
    f.cleanup()
  }
})
