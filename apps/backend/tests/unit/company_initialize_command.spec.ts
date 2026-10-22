import { test } from '@japa/runner'
import { operatorFixture, withOperatorServer } from './operator_command_support.js'

const args = [
  'company:initialize',
  '  Bruce@Wayne.EXAMPLE ',
  'Wayne Enterprises',
  '--confirm-server-stopped',
]
function seedPrincipal(database: ReturnType<ReturnType<typeof operatorFixture>['inspect']>) {
  const now = new Date().toISOString()
  database
    .prepare(
      'INSERT INTO users (id,email,email_verified,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run('bruce', 'bruce@wayne.example', 1, 'Bruce Wayne', 'existing-credential', now, now)
  database
    .prepare(
      'INSERT INTO password_reset_tokens (tokenable_id,email,hash,expires_at,created_at) VALUES (?,?,?,?,?)'
    )
    .run('bruce', 'bruce@wayne.example', 'a'.repeat(64), '2999-01-01T00:00:00.000Z', now)
}

test('company initialization creates canonical defaults and refuses a second setup without changes', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedPrincipal(database)
    database.close()
    const result = f.command(args)
    assert.equal(result.status, 0, result.output)
    const { accountId } = JSON.parse(result.output.trim())
    const inspect = f.inspect()
    const account = inspect.prepare('SELECT * FROM accounts').get()!
    assert.equal(account.id, accountId)
    assert.equal(account.name, 'Wayne Enterprises')
    assert.equal(account.week_starts_on, '1')
    assert.equal(account.working_days, '[1,2,3,4,5]')
    assert.equal(inspect.prepare('SELECT builtin FROM clients').get()!.builtin, 'true')
    assert.deepInclude(inspect.prepare('SELECT * FROM memberships').get()!, {
      user_id: 'bruce',
      role: 'owner',
      status: 'active',
    })
    assert.equal(
      inspect.prepare('SELECT revision FROM company_planning_revisions').get()!.revision,
      1
    )
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').get()!.n, 0)
    const before = inspect.prepare('SELECT * FROM accounts').all()
    inspect.close()
    assert.notEqual(f.command(args).status, 0)
    const after = f.inspect()
    assert.deepEqual(after.prepare('SELECT * FROM accounts').all(), before)
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM memberships').get()!.n, 1)
    assert.equal(
      after.prepare('SELECT password_hash FROM users').get()!.password_hash,
      'existing-credential'
    )
    after.close()
  } finally {
    f.cleanup()
  }
})

test('company initialization refuses missing intent, missing principal and concurrent writer', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    assert.notEqual(f.command(args.slice(0, -1)).status, 0)
    assert.notEqual(f.command(args).status, 0)
    const database = f.inspect()
    seedPrincipal(database)
    database.exec('BEGIN IMMEDIATE')
    const locked = f.command(args)
    assert.notEqual(locked.status, 0)
    assert.match(locked.output, /Another process holds/)
    database.exec('ROLLBACK')
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM accounts').get()!.n, 0)
    database.close()
  } finally {
    f.cleanup()
  }
})

test('company initialization rolls back every row if its audit cannot be recorded', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedPrincipal(database)
    database.exec(
      "CREATE TRIGGER fail_company_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'private database detail'); END"
    )
    database.close()
    const result = f.command(args)
    assert.notEqual(result.status, 0)
    assert.notInclude(result.output, 'private database detail')
    const inspect = f.inspect()
    for (const table of [
      'accounts',
      'clients',
      'memberships',
      'company_planning_revisions',
      'audit_entries',
    ])
      assert.equal(inspect.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0)
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').get()!.n, 1)
    inspect.close()
  } finally {
    f.cleanup()
  }
})

test('company initialization rejects invalid, ambiguous and unavailable sign-in identities', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedPrincipal(database)
    database.close()
    assert.notEqual(
      f.command(['company:initialize', 'invalid', 'Wayne Enterprises', '--confirm-server-stopped'])
        .status,
      0
    )
    assert.notEqual(
      f.command(['company:initialize', 'bruce@wayne.example', ' ', '--confirm-server-stopped'])
        .status,
      0
    )
    const inspect = f.inspect()
    inspect.prepare('UPDATE users SET password_hash = NULL').run()
    inspect.close()
    const noFactor = f.command(args)
    assert.notEqual(noFactor.status, 0)
    assert.match(noFactor.output, /no enabled sign-in method/)
    const ambiguous = f.inspect()
    const now = new Date().toISOString()
    ambiguous
      .prepare(
        'INSERT INTO users (id,email,email_verified,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
      )
      .run('duplicate', 'BRUCE@WAYNE.EXAMPLE', 1, 'Bruce Wayne', 'credential', now, now)
    ambiguous.close()
    const duplicate = f.command(args)
    assert.notEqual(duplicate.status, 0)
    assert.match(duplicate.output, /unambiguous existing identity/)
    const after = f.inspect()
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM accounts').get()!.n, 0)
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM users').get()!.n, 2)
    after.close()
  } finally {
    f.cleanup()
  }
})

test('native signup then stopped-server initialization opens one Owner company after ordinary sign-in', async ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  Object.assign(f.environment, {
    CAPACITYLENS_SETUP_TOKEN: 'operator-native-setup-token-0123456789abcdef',
  })
  const credentials = { email: 'bruce@wayne.example', password: 'native-first-owner-2026' }
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    await withOperatorServer(f, async (origin) => {
      const signup = await fetch(`${origin}/api/auth/sign-up`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
          'x-capacitylens-setup-token': 'operator-native-setup-token-0123456789abcdef',
        },
        body: JSON.stringify({ ...credentials, name: 'Bruce Wayne' }),
      })
      assert.equal(signup.status, 201, await signup.text())
    })
    const initialized = f.command(args)
    assert.equal(initialized.status, 0, initialized.output)
    const { accountId } = JSON.parse(initialized.output.trim())
    await withOperatorServer(f, async (origin) => {
      const signin = await fetch(`${origin}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify(credentials),
      })
      assert.equal(signin.status, 200, await signin.text())
      const cookie = signin.headers
        .getSetCookie()
        .map((value) => value.split(';', 1)[0])
        .join('; ')
      const me = await fetch(`${origin}/api/auth/me`, { headers: { cookie } })
      assert.equal(me.status, 200)
      const companies = await fetch(`${origin}/api/accounts`, { headers: { cookie } })
      assert.deepEqual(await companies.json(), [
        { id: accountId, name: 'Wayne Enterprises', role: 'owner' },
      ])
      const state = await fetch(`${origin}/api/state?accountId=${encodeURIComponent(accountId)}`, {
        headers: { cookie },
      })
      assert.equal(state.status, 200)
      const data = (await state.json()) as {
        clients: { builtin: boolean }[]
        accounts: { weekStartsOn: number; workingDays: number[] }[]
      }
      assert.deepEqual(data.accounts[0]!.workingDays, [1, 2, 3, 4, 5])
      assert.equal(data.accounts[0]!.weekStartsOn, 1)
      assert.lengthOf(data.clients, 1)
      assert.equal(data.clients[0]!.builtin, true)
      const smokeUrl = new URL('../../../../scripts/smoke-packaged-server.mjs', import.meta.url)
      const { writeSmokeSchedule } = (await import(smokeUrl.href)) as {
        writeSmokeSchedule(
          origin: string,
          cookie: string,
          accountId: string,
          fixture: unknown
        ): Promise<{ allocation: { id: string } }>
      }
      const { seed } = await import('@capacitylens/shared/data/seed')
      const { allocation } = await writeSmokeSchedule(origin, cookie, accountId, seed())
      const persisted = f.inspect()
      assert.equal(
        persisted.prepare('SELECT hours_per_day FROM allocations WHERE id = ?').get(allocation.id)!
          .hours_per_day,
        7.5
      )
      persisted.close()
    })
    assert.notEqual(f.command(args).status, 0)
    const after = f.inspect()
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM accounts').get()!.n, 1)
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM memberships').get()!.n, 1)
    after.close()
  } finally {
    f.cleanup()
  }
}).timeout(90000)

test('company initialization accepts an existing stable Google identity only when Google sign-in is enabled', ({
  assert,
  test: t,
}) => {
  t.timeout(90000)
  const f = operatorFixture()
  try {
    assert.equal(f.command(['app:upgrade']).status, 0)
    const database = f.inspect()
    seedPrincipal(database)
    database.prepare('UPDATE users SET password_hash = NULL').run()
    const now = new Date().toISOString()
    database
      .prepare(
        'INSERT INTO provider_identities (id,user_id,provider,issuer,subject,email,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(
        'google-bruce',
        'bruce',
        'google',
        'https://accounts.google.com',
        'stable-bruce',
        'bruce@wayne.example',
        now,
        now
      )
    database.close()
    const disabled = f.command(args)
    assert.notEqual(disabled.status, 0)
    assert.match(disabled.output, /no enabled sign-in method/)
    const enabled = f.command(args, {
      CAPACITYLENS_MODE: 'password-and-sso',
      CAPACITYLENS_GOOGLE_CLIENT_ID: 'fictional-client',
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: 'fictional-secret',
    })
    assert.equal(enabled.status, 0, enabled.output)
    const inspect = f.inspect()
    assert.equal(
      inspect.prepare('SELECT subject FROM provider_identities').get()!.subject,
      'stable-bruce'
    )
    assert.isNull(inspect.prepare('SELECT password_hash FROM users').get()!.password_hash)
    inspect.close()
  } finally {
    f.cleanup()
  }
})

for (const drift of [
  'DROP TABLE deleted_rows',
  'DROP TABLE deleted_groups',
  'DROP TABLE action_proofs',
  'ALTER TABLE planning_mutations RENAME COLUMN origin_session_id TO stale_origin_session_id',
]) {
  test(`company initialization refuses baseline drift: ${drift}`, ({ assert, test: t }) => {
    t.timeout(90000)
    const f = operatorFixture()
    try {
      assert.equal(f.command(['app:upgrade']).status, 0)
      const database = f.inspect()
      seedPrincipal(database)
      const users = database.prepare('SELECT * FROM users').all()
      database.exec(drift)
      database.close()
      const refused = f.command(args)
      assert.notEqual(refused.status, 0, refused.output)
      assert.match(refused.output, /Database schema (?:drift|is not current)/)
      const after = f.inspect()
      assert.deepEqual(after.prepare('SELECT * FROM users').all(), users)
      for (const table of [
        'accounts',
        'clients',
        'memberships',
        'audit_entries',
        'company_planning_revisions',
      ])
        assert.equal(after.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0)
      after.close()
    } finally {
      f.cleanup()
    }
  })
}
