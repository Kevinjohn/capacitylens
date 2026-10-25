import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import env from '#start/env'
import { resetState } from '#services/state_repository'
import { seed } from '@capacitylens/shared/data/seed'
import { buildBetaExport } from '@capacitylens/shared/data/betaTransfer'
import { readState } from '#services/state_repository'
import { signUpAndIn } from '../../helpers/identities.js'

const accountId = 'a-studio'
const otherAccountId = 'a-loft'
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
    secret: env.get('CAPACITYLENS_SECRET'),
    publicUrl: env.get('CAPACITYLENS_PUBLIC_URL'),
    openSignup: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
    allowReset: env.get('CAPACITYLENS_ALLOW_RESET'),
    rateLimit: env.get('CAPACITYLENS_RATE_LIMIT'),
  }
  env.set('CAPACITYLENS_SECRET', 'native-authorization-secret-2026-0123456789')
  env.set('CAPACITYLENS_PUBLIC_URL', 'https://capacity.example.test')
  env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', false)
  env.set('CAPACITYLENS_ALLOW_RESET', true)
  env.set('CAPACITYLENS_RATE_LIMIT', '0')
  cleanup(() => {
    env.set('CAPACITYLENS_SECRET', prior.secret ?? '')
    env.set('CAPACITYLENS_PUBLIC_URL', prior.publicUrl ?? '')
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', prior.openSignup)
    env.set('CAPACITYLENS_ALLOW_RESET', prior.allowReset)
    env.set('CAPACITYLENS_RATE_LIMIT', prior.rateLimit ?? '')
  })
}

async function createMember(client: ApiClient, role: Role) {
  const email = `wayne-${randomUUID()}@example.test`
  const signup = await signUpAndIn(client, { email, password, name: 'Bruce Wayne' })
  signup.assertStatus(200)
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
  const document = buildBetaExport(await readState(accountId, true), {
    accountId,
    completeness: 'full',
  })
  return withSession(trusted(client.post('/api/transfer/apply')), cookie)
    .json({ accountId, document, baseRevision: 0 })
    .send()
}

async function anonymiseResource(client: ApiClient, cookie: string, id: string) {
  return withSession(
    trusted(client.post(`/api/accounts/${accountId}/resources/${id}/anonymise`)),
    cookie
  )
    .json({})
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

/** Awaits a request and asserts its status. */
async function expectStatus(
  request: Promise<{ assertStatus(status: number): void }>,
  status: number
) {
  const response = await request
  response.assertStatus(status)
}

test.group('native authorization and role projections', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await db.from('account_admissions').delete()
    await db.from('account_invitations').delete()
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

  test('four roles separate read, ordinary write, resource anonymisation, and whole-slice import authority', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await createMember(client, 'viewer')
    const anonymiseCandidates = seed().resources.filter((row) => row.accountId === accountId)
    assert.isAtLeast(anonymiseCandidates.length, 2)

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
        false,
        `${role} account-creation projection`
      )

      const write = await writeDismissal(client, cookie)
      assert.equal(write.status(), role === 'viewer' ? 403 : 200, `${role} ordinary write`)

      const target = role === 'owner' ? anonymiseCandidates[1]! : anonymiseCandidates[0]!
      const anonymised = await anonymiseResource(client, cookie, target.id)
      assert.equal(
        anonymised.status(),
        role === 'admin' || role === 'owner' ? 204 : 403,
        `${role} resource anonymisation`
      )

      const importing = await importSeed(client, cookie)
      assert.equal(importing.status(), 403, `${role} import without action proof`)

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

  test('import needs an action proof however recent the sign-in, while reads and writes do not', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await createMember(client, 'owner')
    for (const ageMinutes of [0, 16]) {
      await db
        .from('account_sessions')
        .where('user_id', userId)
        .update({ created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString() })
      const imported = await importSeed(client, cookie)
      imported.assertStatus(403)
      assert.equal((imported.body() as { code?: string }).code, 'ACTION_PROOF_REQUIRED')
      await expectStatus(stateFor(client, cookie), 200)
      await expectStatus(writeDismissal(client, cookie), 200)
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
