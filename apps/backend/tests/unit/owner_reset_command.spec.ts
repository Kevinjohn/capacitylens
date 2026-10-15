import { test } from '@japa/runner'
import { operatorFixture, seedOwner, withOperatorServer } from './operator_command_support.js'

const args = ['owner:reset-password', 'bruce@wayne.example', '--confirm-server-stopped']

test('owner command issues a private audited ceremony and replaces earlier tokens', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    const init = f.command(['app:upgrade'])
    assert.equal(init.status, 0, init.output)
    const database = f.inspect()
    seedOwner(database)
    database.close()
    const first = f.command([
      'owner:reset-password',
      '  Bruce@Wayne.EXAMPLE ',
      '--confirm-server-stopped',
    ])
    assert.equal(first.status, 0, first.output)
    const firstResult = JSON.parse(first.output.trim()) as { link: string; accountIds: string[] }
    assert.deepEqual(firstResult.accountIds, ['a-studio'])
    assert.match(firstResult.link, /^http:\/\/localhost:8787\/reset-password\//)
    const second = f.command(args)
    assert.equal(second.status, 0, second.output)
    const secondResult = JSON.parse(second.output.trim()) as { link: string }
    assert.notEqual(firstResult.link, secondResult.link)
    const inspect = f.inspect()
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM account_recovery_tokens').get()!.n, 1)
    const audits = inspect.prepare('SELECT * FROM audit_entries').all()
    assert.lengthOf(audits, 2)
    assert.equal(audits[0]!.actor_id, null)
    assert.equal(audits[0]!.action, 'identity.owner_recovery_issued')
    assert.notInclude(JSON.stringify(audits), firstResult.link.split('/').at(-1)!)
    assert.equal(
      inspect.prepare('SELECT password_hash FROM users').get()!.password_hash,
      'old-credential'
    )
    inspect.close()
  } finally {
    f.cleanup()
  }
})

test('owner command refuses missing stop intent, non-owner targets and concurrent writers', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedOwner(database)
    assert.notEqual(f.command(args.slice(0, -1)).status, 0)
    database.exec('BEGIN IMMEDIATE')
    const locked = f.command(args)
    assert.notEqual(locked.status, 0, locked.output)
    assert.match(locked.output, /Another process holds/)
    database.exec('ROLLBACK')
    database.prepare("UPDATE memberships SET role='admin'").run()
    database.close()
    const denied = f.command(args)
    assert.notEqual(denied.status, 0, denied.output)
    assert.notInclude(denied.output, 'bruce@wayne.example')
    const inspect = f.inspect()
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM account_recovery_tokens').get()!.n, 0)
    inspect.close()
  } finally {
    f.cleanup()
  }
})

test('audit failure rolls back token replacement and never prints the issued secret', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedOwner(database)
    database.close()
    const first = f.command(args)
    assert.equal(first.status, 0, first.output)
    const inspect = f.inspect()
    const before = inspect.prepare('SELECT token_hash FROM account_recovery_tokens').get()!
      .token_hash
    inspect.exec(
      "CREATE TRIGGER fail_operator_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'operator audit failed'); END"
    )
    inspect.close()
    const failed = f.command(args)
    const after = f.inspect()
    assert.notEqual(failed.status, 0)
    assert.notInclude(failed.output, '/reset-password/')
    assert.equal(
      after.prepare('SELECT token_hash FROM account_recovery_tokens').get()!.token_hash,
      before
    )
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM audit_entries').get()!.n, 1)
    after.close()
  } finally {
    f.cleanup()
  }
})

test('a sole-owned company permits recovery even when another company has joint Owners', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedOwner(database)
    const now = new Date().toISOString()
    database
      .prepare('INSERT INTO accounts (id,name,color,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('a-loft', 'Stark Industries', '#6366f1', now, now)
    database
      .prepare(
        'INSERT INTO users (id,email,email_verified,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
      )
      .run('tony', 'tony@stark.example', 1, 'Tony Stark', 'credential', now, now)
    for (const id of ['bruce', 'tony'])
      database
        .prepare(
          'INSERT INTO memberships (id,account_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(`joint-${id}`, 'a-loft', id, 'owner', 'active', now, now)
    database.close()
    const recovered = f.command(args)
    assert.equal(recovered.status, 0, recovered.output)
    assert.deepEqual(JSON.parse(recovered.output.trim()).accountIds, ['a-studio'])
    const inspect = f.inspect()
    inspect.prepare("DELETE FROM memberships WHERE account_id='a-studio'").run()
    inspect.close()
    const refused = f.command(args)
    assert.notEqual(refused.status, 0)
    assert.match(refused.output, /sole active Owner/)
  } finally {
    f.cleanup()
  }
})

test('a failure writing the second company audit rolls back every audit and the replacement token', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedOwner(database)
    const now = new Date().toISOString()
    database
      .prepare('INSERT INTO accounts (id,name,color,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('a-loft', 'Stark Industries', '#6366f1', now, now)
    database
      .prepare(
        'INSERT INTO memberships (id,account_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
      )
      .run('second-owner', 'a-loft', 'bruce', 'owner', 'active', now, now)
    database.exec(
      "CREATE TRIGGER fail_second_audit BEFORE INSERT ON audit_entries WHEN NEW.account_id='a-studio' BEGIN SELECT RAISE(ABORT, 'second audit failed'); END"
    )
    database.close()
    const result = f.command(args)
    assert.notEqual(result.status, 0)
    const inspect = f.inspect()
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM audit_entries').get()!.n, 0)
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM account_recovery_tokens').get()!.n, 0)
    inspect.close()
  } finally {
    f.cleanup()
  }
})

test('the issued owner link redeems once through the normal HTTP flow and revokes indexed sessions', async ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedOwner(database)
    database
      .prepare(
        'INSERT INTO user_session_index (user_id,session_id,authenticated_at,last_activity_at) VALUES (?,?,?,?)'
      )
      .run('bruce', 'prior-session', Date.now(), Date.now())
    database.close()
    const issued = f.command(args)
    assert.equal(issued.status, 0, issued.output)
    const token = new URL(JSON.parse(issued.output.trim()).link).pathname.split('/').at(-1)!
    await withOperatorServer(f, async (origin) => {
      const reset = () =>
        fetch(`${origin}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
          body: JSON.stringify({ token, newPassword: 'owner-recovered-password-2026' }),
        })
      const redeemed = await reset()
      assert.equal(redeemed.status, 200)
      const replayed = await reset()
      assert.notEqual(replayed.status, 200)
      const signin = await fetch(`${origin}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'bruce@wayne.example',
          password: 'owner-recovered-password-2026',
        }),
      })
      assert.equal(signin.status, 200)
    })
    const inspect = f.inspect()
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM account_recovery_tokens').get()!.n, 0)
    assert.equal(
      inspect
        .prepare("SELECT COUNT(*) AS n FROM user_session_index WHERE session_id='prior-session'")
        .get()!.n,
      0
    )
    assert.equal(
      inspect
        .prepare("SELECT COUNT(*) AS n FROM audit_entries WHERE action='user.password_reset'")
        .get()!.n,
      1
    )
    inspect.close()
  } finally {
    f.cleanup()
  }
}).timeout(90000)

test('owner recovery refuses invalid configuration, addresses and non-disk paths without minting', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedOwner(database)
    database.close()
    for (const overrides of [
      { CAPACITYLENS_MODE: 'off' },
      { CAPACITYLENS_MODE: 'sso-only' },
      { CAPACITYLENS_PUBLIC_URL: '' },
      { CAPACITYLENS_DB: ':memory:' },
      { CAPACITYLENS_DB: `${f.databasePath}.missing` },
    ])
      assert.notEqual(f.command(args, overrides).status, 0)
    assert.notEqual(
      f.command(['owner:reset-password', 'invalid@@wayne.example', '--confirm-server-stopped'])
        .status,
      0
    )
    const inspect = f.inspect()
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM account_recovery_tokens').get()!.n, 0)
    inspect.close()
  } finally {
    f.cleanup()
  }
})

test('normalized duplicate identities are refused without exposing the target or issuing a token', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedOwner(database)
    const now = new Date().toISOString()
    database
      .prepare(
        'INSERT INTO users (id,email,email_verified,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
      )
      .run('ambiguous', 'BRUCE@WAYNE.EXAMPLE', 1, 'Clark Kent', 'credential', now, now)
    database.close()
    const result = f.command(args)
    assert.notEqual(result.status, 0)
    assert.include(result.output, 'unambiguous')
    assert.notInclude(result.output, 'bruce@wayne.example')
    const inspect = f.inspect()
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM account_recovery_tokens').get()!.n, 0)
    inspect.close()
  } finally {
    f.cleanup()
  }
})
