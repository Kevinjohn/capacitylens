import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { resetState } from '#services/state_repository'

const setupToken = 'masquerade-setup-token-0123456789abcdef'
const password = 'batman-secret-2026'

function asSession<
  T extends {
    setup(callback: (request: T) => void): T
    withCookie(name: string, value: string): T
  },
>(request: T, cookie: string): T {
  return request.setup((prepared) => {
    prepared.withCookie('adonis-session', cookie)
  })
}

async function fixture(client: any, targetRole: 'viewer' | 'editor' = 'viewer') {
  const owner = await client
    .post('/api/auth/sign-up')
    .header('sec-fetch-site', 'same-origin')
    .header('x-capacitylens-setup-token', setupToken)
    .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
    .send()
  owner.assertStatus(201)
  const cookie = owner.cookie('adonis-session')!.value
  const ownerId = String((owner.body() as { user: { id: string } }).user.id)
  const company = await asSession(
    client.post('/api/orgs').header('sec-fetch-site', 'same-origin'),
    cookie
  )
    .json({ id: 'a-studio', name: 'Wayne Enterprises' })
    .send()
  company.assertStatus(201)
  const targetId = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.table('users').insert({
    id: targetId,
    email: 'clark.kent@wayne.example',
    display_name: 'Clark Kent',
    email_verified: true,
    password_hash: null,
    created_at: now,
    updated_at: now,
  })
  await db.table('memberships').insert({
    id: crypto.randomUUID(),
    account_id: 'a-studio',
    user_id: targetId,
    role: targetRole,
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  return { cookie, ownerId, targetId }
}

test.group('native read-only masquerade', (group) => {
  group.setup(() => {
    const old = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      screening: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    return () => {
      env.set('CAPACITYLENS_MODE', old.mode ?? 'off')
      env.set('CAPACITYLENS_SETUP_TOKEN', old.setup ?? '')
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', old.screening)
    }
  })
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('uses the target role for reads, real actor for audit, and explicit end restores access', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client)
    const privateClientId = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.table('clients').insert({
      id: privateClientId,
      account_id: 'a-studio',
      name: 'Wayne Confidential Client',
      code_name: 'Nightwing',
      color: '#123456',
      is_private: 'true',
      created_at: now,
      updated_at: now,
    })
    const ownerRead = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send()
    ownerRead.assertStatus(200)
    assert.include(JSON.stringify(ownerRead.body()), 'Wayne Confidential Client')
    const started = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send()
    started.assertStatus(200)
    const state = started.body() as {
      accountId: string
      targetUserId: string
      effectiveRole: string
      token: string
    }
    assert.equal(state.accountId, 'a-studio')
    assert.equal(state.targetUserId, targetId)
    assert.equal(state.effectiveRole, 'viewer')
    const status = await asSession(client.get('/api/masquerade'), cookie).send()
    status.assertStatus(200)
    const active = status.body() as {
      active: boolean
      principal: { id: string; email: string }
      authMode: string
    }
    assert.isTrue(active.active)
    assert.equal(active.principal.id, ownerId)
    assert.equal(active.principal.email, 'bruce.wayne@wayne.example')
    assert.equal(active.authMode, 'password-only')
    const read = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send()
    read.assertStatus(200)
    assert.notInclude(JSON.stringify(read.body()), 'Wayne Confidential Client')
    assert.include(JSON.stringify(read.body()), 'Nightwing')
    const foreign = await asSession(client.get('/api/state?accountId=a-loft'), cookie).send()
    foreign.assertStatus(403)
    const account = await asSession(client.get('/api/accounts'), cookie).send()
    account.assertStatus(403)
    assert.equal((account.body() as unknown as { code: string }).code, 'MASQUERADE_READ_ONLY')
    const audit = await db
      .from('audit_entries')
      .where('action', 'identity.masquerade_started')
      .first()
    assert.equal(audit.actor_id, ownerId)

    const ended = await asSession(
      client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ token: state.token, reason: 'explicit' })
      .send()
    ended.assertStatus(204)
    const after = await asSession(client.get('/api/accounts'), cookie).send()
    after.assertStatus(200)
    const endAudit = await db
      .from('audit_entries')
      .where('action', 'identity.masquerade_ended')
      .first()
    assert.equal(endAudit.actor_id, ownerId)
  })

  test('refuses unsafe and auth routes before malformed or unknown-route validation', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId } = await fixture(client, 'editor')
    const started = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send()
    started.assertStatus(200)
    assert.equal((started.body() as { effectiveRole: string }).effectiveRole, 'editor')
    const editorRead = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send()
    editorRead.assertStatus(200)
    const examples = [
      asSession(client.post('/api/projects').header('sec-fetch-site', 'same-origin'), cookie).json(
        {}
      ),
      asSession(
        client.post('/api/no-such-route').header('sec-fetch-site', 'same-origin'),
        cookie
      ).json({}),
      asSession(client.post('/no-such-route').header('sec-fetch-site', 'same-origin'), cookie).json(
        {}
      ),
      asSession(
        client.post('/api/auth/sign-in').header('sec-fetch-site', 'same-origin'),
        cookie
      ).json({}),
      asSession(client.get('/api/auth/me'), cookie),
      asSession(client.get('/api/accounts/a-studio/members'), cookie),
    ]
    for (const request of examples) {
      const response = await request.send()
      response.assertStatus(403)
      assert.equal((response.body() as { code: string }).code, 'MASQUERADE_READ_ONLY')
    }
    const malformed = await asSession(
      client
        .post('/api/no-such-route')
        .header('sec-fetch-site', 'same-origin')
        .header('content-type', 'application/json'),
      cookie
    ).setup((request) => {
      request.request.send('{')
    })
    malformed.assertStatus(403)
    assert.equal((malformed.body() as { code: string }).code, 'MASQUERADE_READ_ONLY')
    const signedOut = await asSession(
      client.post('/api/auth/sign-out').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({})
      .send()
    signedOut.assertStatus(200)
    assert.equal(
      await db
        .from('masquerades')
        .count('* as total')
        .first()
        .then((row) => row?.total),
      0
    )
  })

  test('rejects self, inactive target, and malformed session authority', async ({ client }) => {
    const { cookie, ownerId, targetId } = await fixture(client)
    const self = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: ownerId })
      .send()
    self.assertStatus(400)
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: targetId })
      .update({ status: 'disabled' })
    const inactive = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send()
    inactive.assertStatus(404)
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: targetId })
      .update({ status: 'active' })
    const now = new Date().toISOString()
    await db.table('accounts').insert({
      id: 'a-loft',
      name: 'Stark Industries',
      color: '#123456',
      created_at: now,
      updated_at: now,
    })
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: targetId })
      .update({ account_id: 'a-loft' })
    const foreign = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send()
    foreign.assertStatus(404)
    await db
      .from('memberships')
      .where({ account_id: 'a-loft', user_id: targetId })
      .update({ account_id: 'a-studio' })
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: ownerId })
      .update({ role: 'viewer' })
    const nonAdmin = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send()
    nonAdmin.assertStatus(403)
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: ownerId })
      .update({ role: 'owner' })
    await db
      .from('user_session_index')
      .where('user_id', ownerId)
      .update({ authenticated_at: Date.now() - 16 * 60_000 })
    const stale = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send()
    stale.assertStatus(401)
  })

  test('ends an open view as soon as the viewer loses the role that permits it', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client, 'editor')
    const started = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send()
    started.assertStatus(200)
    const token = (started.body() as { token: string }).token
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: ownerId })
      .update({ role: 'viewer' })
    const read = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send()
    read.assertStatus(403)
    const exported = await asSession(client.get('/api/export?accountId=a-studio'), cookie).send()
    assert.oneOf(exported.status(), [403, 404])
    const status = await asSession(client.get('/api/masquerade'), cookie).send()
    status.assertStatus(403)
    const ended = await asSession(
      client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ token, reason: 'explicit' })
      .send()
    ended.assertStatus(204)
  })

  test('allows a valid Owner session older than the fresh-action window to start viewing', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client)
    const indexed = await db.from('user_session_index').where('user_id', ownerId).first()
    assert.isDefined(indexed)
    const now = Date.now
    Date.now = () => Number(indexed!.authenticated_at) + 16 * 60_000
    try {
      const started = await asSession(
        client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
        cookie
      )
        .json({ targetUserId: targetId })
        .send()
      started.assertStatus(200)
      assert.equal((started.body() as { targetUserId: string }).targetUserId, targetId)
    } finally {
      Date.now = now
    }
  })

  test('reports inactive for off mode, anonymous and revoked sessions without restoring data access', async ({
    client,
    assert,
  }) => {
    const anonymous = await client.get('/api/masquerade').send()
    anonymous.assertStatus(200)
    assert.deepEqual(anonymous.body(), { active: false })
    const { cookie, targetId } = await fixture(client)
    const started = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send()
    started.assertStatus(200)
    await db.from('user_session_index').delete()
    const revoked = await asSession(client.get('/api/masquerade'), cookie).send()
    revoked.assertStatus(200)
    assert.deepEqual(revoked.body(), { active: false })
    const deniedRead = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send()
    deniedRead.assertStatus(401)
    env.set('CAPACITYLENS_MODE', 'off')
    const off = await client.get('/api/masquerade').send()
    off.assertStatus(200)
    assert.deepEqual(off.body(), { active: false })
    const offStart = await client
      .post('/api/accounts/a-studio/masquerade')
      .header('sec-fetch-site', 'same-origin')
      .json({ targetUserId: targetId })
      .send()
    offStart.assertStatus(403)
    env.set('CAPACITYLENS_MODE', 'password-only')
  })
})
