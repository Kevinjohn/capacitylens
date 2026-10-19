import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import env from '#start/env'
import { resetState } from '#services/state_repository'
import { seed } from '@capacitylens/shared/data/seed'

const accountId = 'a-studio'
const otherAccountId = 'a-loft'
const setupToken = 'native-auth-setup-token-0123456789abcdef'
const password = 'batman-secret-2026'
const privateClientName = 'SENTINEL_PRIVATE_CLIENT_NAME'
const privateProjectName = 'SENTINEL_PRIVATE_PROJECT_NAME'
const privateTimeOffNote = 'SENTINEL_PRIVATE_TIME_OFF_NOTE'
const roles = ['viewer', 'editor', 'admin', 'owner'] as const
type Role = (typeof roles)[number]

function trusted<T extends { header(name: string, value: string): T }>(request: T) {
  return request.header('sec-fetch-site', 'same-origin')
}

function withSession<
  T extends { setup(callback: () => void): T; withCookie(name: string, value: string): T },
>(request: T, cookie: string): T {
  return request.setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

function configureAuth(cleanup: (callback: () => void) => void) {
  const prior = {
    mode: env.get('CAPACITYLENS_MODE'),
    secret: env.get('CAPACITYLENS_SECRET'),
    publicUrl: env.get('CAPACITYLENS_PUBLIC_URL'),
    setupToken: env.get('CAPACITYLENS_SETUP_TOKEN'),
    openSignup: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
    breachCheck: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
    allowReset: env.get('CAPACITYLENS_ALLOW_RESET'),
    rateLimit: env.get('CAPACITYLENS_RATE_LIMIT'),
    multiAccount: env.get('CAPACITYLENS_MULTI_ACCOUNT'),
    multiAccountProcess: process.env.CAPACITYLENS_MULTI_ACCOUNT,
  }
  env.set('CAPACITYLENS_MODE', 'password-only')
  env.set('CAPACITYLENS_SECRET', 'native-authorization-secret-2026-0123456789')
  env.set('CAPACITYLENS_PUBLIC_URL', 'https://capacity.example.test')
  env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
  env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', false)
  env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
  env.set('CAPACITYLENS_ALLOW_RESET', true)
  env.set('CAPACITYLENS_RATE_LIMIT', '0')
  env.set('CAPACITYLENS_MULTI_ACCOUNT', true)
  cleanup(() => {
    env.set('CAPACITYLENS_MODE', prior.mode ?? 'off')
    env.set('CAPACITYLENS_SECRET', prior.secret ?? '')
    env.set('CAPACITYLENS_PUBLIC_URL', prior.publicUrl ?? '')
    env.set('CAPACITYLENS_SETUP_TOKEN', prior.setupToken ?? '')
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', prior.openSignup)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', prior.breachCheck)
    env.set('CAPACITYLENS_ALLOW_RESET', prior.allowReset)
    env.set('CAPACITYLENS_RATE_LIMIT', prior.rateLimit ?? '')
    env.set('CAPACITYLENS_MULTI_ACCOUNT', prior.multiAccount)
    if (prior.multiAccountProcess === undefined) delete process.env.CAPACITYLENS_MULTI_ACCOUNT
    else process.env.CAPACITYLENS_MULTI_ACCOUNT = prior.multiAccountProcess
  })
}

async function createMember(client: ApiClient, role: Role) {
  const email = `wayne-${randomUUID()}@example.test`
  const signup = await trusted(client.post('/api/auth/sign-up'))
    .header('x-capacitylens-setup-token', setupToken)
    .json({ email, password, name: 'Bruce Wayne' })
    .send()
  signup.assertStatus(201)
  const cookie = signup.cookie('adonis-session')?.value
  if (!cookie) throw new Error('Sign-up did not return a native session cookie')
  const userId = String((signup.body() as { user: { id: string } }).user.id)
  const timestamp = new Date().toISOString()
  await db.table('memberships').insert({
    id: randomUUID(),
    account_id: accountId,
    user_id: userId,
    role,
    status: 'active',
    created_at: timestamp,
    updated_at: timestamp,
  })
  return { cookie, userId }
}

async function setRole(userId: string, role: Role) {
  await db.from('memberships').where({ account_id: accountId, user_id: userId }).update({ role })
}

async function stateFor(client: ApiClient, cookie: string, companyId = accountId) {
  return withSession(
    trusted(client.get(`/api/state?accountId=${encodeURIComponent(companyId)}`)),
    cookie
  ).send()
}

async function currentUser(client: ApiClient, cookie: string) {
  return withSession(trusted(client.get('/api/auth/me')), cookie).send()
}

async function writeDismissal(client: ApiClient, cookie: string) {
  return withSession(trusted(client.put(`/api/accounts/${accountId}/getting-started`)), cookie)
    .json({ dismissed: true })
    .send()
}

async function importSeed(client: ApiClient, cookie: string) {
  return withSession(trusted(client.post('/api/import')), cookie)
    .json({ accountId, data: seed() })
    .send()
}

async function purgeOldClient(client: ApiClient, cookie: string, id: string) {
  return withSession(trusted(client.post(`/api/clients/${id}/purge`)), cookie)
    .json({ accountId })
    .send()
}

async function preparePrivateProjection() {
  const fixture = seed()
  const client = fixture.clients.find((row) => row.accountId === accountId && row.builtin !== true)
  const project = fixture.projects.find((row) => row.accountId === accountId)
  const resource = fixture.resources.find((row) => row.accountId === accountId)
  const timeOff = fixture.timeOff.find((row) => row.accountId === accountId)
  if (!client || !project || !resource || !timeOff)
    throw new Error('Seed data is missing the authorization projection fixture')
  await db
    .from('clients')
    .where({ id: client.id })
    .update({ name: privateClientName, is_private: 'true', code_name: 'Nightwing' })
  await db
    .from('projects')
    .where({ id: project.id })
    .update({ name: privateProjectName, is_private: 'true', code_name: 'Aurora' })
  await db.from('time_off').where({ id: timeOff.id }).update({ note: privateTimeOffNote })
  return {
    clientId: client.id,
    projectId: project.id,
    resourceId: resource.id,
    timeOffId: timeOff.id,
  }
}

test.group('native authorization and role projections', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('memberships').delete()
    await db.from('users').delete()
    await db.from('rate_limits').delete()
    await db.from('account_getting_started_dismissals').delete()
    await resetState(true)
  })

  test('protected reads require a real member and cross-account rows stay concealed', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await createMember(client, 'editor')

    const anonymous = await trusted(client.get(`/api/state?accountId=${accountId}`)).send()
    anonymous.assertStatus(401)
    const openHealth = await client.get('/api/health').send()
    openHealth.assertStatus(200)

    await db.from('memberships').where({ user_id: userId }).delete()
    const nonMember = await stateFor(client, cookie)
    nonMember.assertStatus(403)
    const nonMemberProjection = await currentUser(client, cookie)
    nonMemberProjection.assertStatus(200)
    assert.isFalse((nonMemberProjection.body() as { canCreateAccount: boolean }).canCreateAccount)

    await db.table('memberships').insert({
      id: randomUUID(),
      account_id: accountId,
      user_id: userId,
      role: 'editor',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const foreignRead = await stateFor(client, cookie, otherAccountId)
    foreignRead.assertStatus(403)

    const foreignClient = seed().clients.find((row) => row.accountId === otherAccountId)
    assert.isDefined(foreignClient)
    const concealed = await withSession(
      trusted(client.post(`/api/clients/${foreignClient!.id}/archive`)),
      cookie
    )
      .json({ accountId })
      .send()
    concealed.assertStatus(404)
    assert.notInclude(JSON.stringify(concealed.body()), foreignClient!.name)
    const foreignRow = await db.from('clients').where({ id: foreignClient!.id }).first()
    assert.equal(foreignRow?.account_id, otherAccountId)
  })

  test('four roles separate read, ordinary write, purge, and whole-slice import authority', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await createMember(client, 'viewer')
    const purgeCandidates = seed().clients.filter(
      (row) => row.accountId === accountId && row.builtin !== true
    )
    assert.isAtLeast(purgeCandidates.length, 2)
    for (const row of purgeCandidates.slice(0, 2))
      await db
        .from('clients')
        .where({ id: row.id })
        .update({ deleted_at: '2020-01-01T00:00:00.000Z' })

    for (const role of roles) {
      await setRole(userId, role)
      const read = await stateFor(client, cookie)
      read.assertStatus(200)
      const body = read.body() as {
        accounts: Array<{ id: string }>
        clients: Array<{ accountId: string }>
      }
      assert.deepEqual(
        body.accounts.map((row) => row.id),
        [accountId]
      )
      assert.isTrue(body.clients.every((row) => row.accountId === accountId))

      const me = await currentUser(client, cookie)
      me.assertStatus(200)
      assert.equal(
        (me.body() as { canCreateAccount: boolean }).canCreateAccount,
        role === 'owner' || role === 'admin',
        `${role} account-creation projection`
      )

      const write = await writeDismissal(client, cookie)
      assert.equal(write.status(), role === 'viewer' ? 403 : 200, `${role} ordinary write`)

      const purgeTarget = role === 'owner' ? purgeCandidates[1]! : purgeCandidates[0]!
      const purge = await purgeOldClient(client, cookie, purgeTarget.id)
      assert.equal(
        purge.status(),
        role === 'admin' || role === 'owner' ? 204 : 403,
        `${role} purge`
      )

      const importing = await importSeed(client, cookie)
      assert.equal(importing.status(), role === 'owner' ? 200 : 403, `${role} import`)

      if (role === 'owner') {
        const reset = await withSession(trusted(client.post('/api/test/reset')), cookie)
          .json({ seed: false })
          .send()
        reset.assertStatus(403)
        assert.isNotNull(await db.from('accounts').where({ id: accountId }).first())
      }
    }
  })

  test('state projection scopes resources and redacts private names and time-off notes by role', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await createMember(client, 'owner')
    const fixture = await preparePrivateProjection()

    for (const role of roles) {
      await setRole(userId, role)
      const response = await stateFor(client, cookie)
      response.assertStatus(200)
      const serialized = JSON.stringify(response.body())
      const body = response.body() as {
        clients: Array<{ id: string; name: string; codeName?: string | null }>
        projects: Array<{ id: string; name: string; codeName?: string | null }>
        resources: Array<{ id: string; accountId: string }>
        timeOff: Array<{ id: string; note?: string | null }>
      }
      const projectedClient = body.clients.find((row) => row.id === fixture.clientId)
      const projectedProject = body.projects.find((row) => row.id === fixture.projectId)
      const projectedTimeOff = body.timeOff.find((row) => row.id === fixture.timeOffId)
      assert.isDefined(projectedClient, `${role} client projection`)
      assert.isDefined(projectedProject, `${role} project projection`)
      assert.isDefined(projectedTimeOff, `${role} time-off projection`)
      assert.isTrue(body.resources.every((row) => row.accountId === accountId))
      assert.include(
        body.resources.map((row) => row.id),
        fixture.resourceId
      )

      if (role === 'owner') {
        assert.equal(projectedClient!.name, privateClientName)
        assert.equal(projectedProject!.name, privateProjectName)
        assert.equal(projectedClient!.codeName, 'Nightwing')
        assert.equal(projectedProject!.codeName, 'Aurora')
        assert.equal(projectedTimeOff!.note, privateTimeOffNote)
      } else {
        assert.equal(projectedClient!.name, '"Nightwing"')
        assert.equal(projectedProject!.name, '"Aurora"')
        assert.isNull(projectedClient!.codeName)
        assert.isNull(projectedProject!.codeName)
        assert.notInclude(serialized, privateClientName)
        assert.notInclude(serialized, privateProjectName)
        if (role === 'admin') assert.equal(projectedTimeOff!.note, privateTimeOffNote)
        else {
          assert.isNull(projectedTimeOff!.note)
          assert.notInclude(serialized, privateTimeOffNote)
        }
      }
    }
  })

  test('freshness is exclusive at 15 minutes and ordinary read/write remain available', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await createMember(client, 'owner')
    const index = await db.from('user_session_index').where({ user_id: userId }).first()
    assert.isDefined(index)
    const authenticatedAt = Number(index!.authenticated_at)
    const realNow = Date.now
    const importing = () => importSeed(client, cookie)
    try {
      Date.now = () => authenticatedAt + 15 * 60 * 1000 - 1
      const justFresh = await importing()
      justFresh.assertStatus(200)

      Date.now = () => authenticatedAt + 15 * 60 * 1000
      const staleExport = await stateFor(client, cookie)
      staleExport.assertStatus(200)
      const staleWrite = await writeDismissal(client, cookie)
      staleWrite.assertStatus(200)
      const staleImport = await importing()
      staleImport.assertStatus(403)
      assert.equal((staleImport.body() as { code?: string }).code, 'SESSION_NOT_FRESH')
    } finally {
      Date.now = realNow
    }
  })

  test('administrator purge requires fresh session assurance', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await createMember(client, 'admin')
    const candidate = seed().clients.find(
      (row) => row.accountId === accountId && row.builtin !== true
    )
    assert.isDefined(candidate)
    await db.from('clients').where({ id: candidate!.id }).update({
      deleted_at: '2020-01-01T00:00:00.000Z',
    })
    const index = await db.from('user_session_index').where({ user_id: userId }).first()
    assert.isDefined(index)
    const realNow = Date.now
    Date.now = () => Number(index!.authenticated_at) + 15 * 60 * 1000
    try {
      const purge = await purgeOldClient(client, cookie, candidate!.id)
      purge.assertStatus(403)
      assert.equal((purge.body() as { code?: string }).code, 'SESSION_NOT_FRESH')
      assert.isNotNull(await db.from('clients').where({ id: candidate!.id }).first())
    } finally {
      Date.now = realNow
    }
  })

  test('a current role downgrade takes effect on the next data transaction', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await createMember(client, 'admin')
    const before = await writeDismissal(client, cookie)
    before.assertStatus(200)

    await setRole(userId, 'viewer')
    const denied = await writeDismissal(client, cookie)
    denied.assertStatus(403)
    const stillReadable = await stateFor(client, cookie)
    stillReadable.assertStatus(200)
    assert.deepEqual(
      await db
        .from('account_getting_started_dismissals')
        .where('account_id', accountId)
        .count('* as total'),
      [{ total: 1 }]
    )
  })
})
