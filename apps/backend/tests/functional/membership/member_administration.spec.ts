import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { resetState } from '#services/state_repository'

const setupToken = 'member-setup-token-0123456789abcdef'
const password = 'batman-secret-2026'

function signed<
  T extends { setup(callback: () => void): T; withCookie(name: string, value: string): T },
>(request: T, cookie: string): T {
  return request.setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

async function userId(email: string) {
  const user = await db.from('users').where('email', email).first()
  if (!user) throw new Error(`Missing test principal: ${email}`)
  return String(user.id)
}

test.group('company member administration', (group) => {
  group.setup(() => {
    const original = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      signup: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
      multi: env.get('CAPACITYLENS_MULTI_ACCOUNT'),
      multiProcess: process.env.CAPACITYLENS_MULTI_ACCOUNT,
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    env.set('CAPACITYLENS_MULTI_ACCOUNT', true)
    return () => {
      env.set('CAPACITYLENS_MODE', original.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', original.setup)
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', original.signup)
      env.set('CAPACITYLENS_MULTI_ACCOUNT', original.multi)
      if (original.multiProcess === undefined) delete process.env.CAPACITYLENS_MULTI_ACCOUNT
      else process.env.CAPACITYLENS_MULTI_ACCOUNT = original.multiProcess
    }
  })
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('role command replays its semantic result, binds payload and burns recovery only on change', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const created = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    created.assertStatus(201)
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const editorId = await userId('clark.kent@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-clark',
      account_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    await db.table('account_recovery_tokens').insert({
      user_id: editorId,
      email: 'clark.kent@wayne.example',
      token_hash: 'a'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: now,
    })
    const path = `/api/accounts/a-studio/members/${editorId}`
    const identity = {
      'x-account-command-id': 'member-role-command-0001',
      'idempotency-key': 'member-role-idempotency-0001',
    }
    const requestRole = (role: string) =>
      signed(client.patch(path), ownerCookie).headers(identity).json({ role }).send()
    const changed = await requestRole('admin')
    changed.assertStatus(200)
    assert.deepEqual(changed.body(), { userId: editorId, role: 'admin' })
    assert.isNull(await db.from('account_recovery_tokens').where('user_id', editorId).first())
    const replay = await requestRole('admin')
    replay.assertStatus(200)
    assert.deepEqual(replay.body(), changed.body())
    const mismatch = await requestRole('viewer')
    mismatch.assertStatus(409)
    assert.equal((mismatch.body() as { code: string }).code, 'IDEMPOTENCY_CONFLICT')
    const audits = await db
      .from('audit_entries')
      .where({ account_id: 'a-studio', action: 'member.role_changed', entity_id: editorId })
    assert.lengthOf(audits, 1)
    await db.table('account_recovery_tokens').insert({
      user_id: editorId,
      email: 'clark.kent@wayne.example',
      token_hash: 'c'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: now,
    })
    const unchanged = await signed(client.patch(path), ownerCookie)
      .headers({
        'x-account-command-id': 'member-role-command-noop-0001',
        'idempotency-key': 'member-role-idempotency-noop-0001',
      })
      .json({ role: 'admin' })
      .send()
    unchanged.assertStatus(200)
    const unchangedToken = await db
      .from('account_recovery_tokens')
      .where('user_id', editorId)
      .first()
    assert.equal(unchangedToken.token_hash, 'c'.repeat(64))
    const ownerId = await userId('bruce.wayne@wayne.example')
    const refused = await signed(
      client.patch(`/api/accounts/a-studio/members/${ownerId}`),
      ownerCookie
    )
      .json({ role: 'viewer' })
      .send()
    refused.assertStatus(403)
  })

  test('an authorized Admin receives input refusal for direct Owner assignment, but cannot edit the Owner', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const company = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    company.assertStatus(201)
    const admin = await client
      .post('/api/auth/sign-up')
      .json({ email: 'diana.prince@wayne.example', password, name: 'Diana Prince' })
      .send()
    admin.assertStatus(201)
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const ownerId = await userId('bruce.wayne@wayne.example')
    const adminId = await userId('diana.prince@wayne.example')
    const editorId = await userId('clark.kent@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert([
      {
        id: 'member-diana',
        account_id: 'a-studio',
        user_id: adminId,
        role: 'admin',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'member-clark',
        account_id: 'a-studio',
        user_id: editorId,
        role: 'editor',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ])
    const adminCookie = admin.cookie('adonis-session')!.value
    const invalidPromotion = await signed(
      client.patch(`/api/accounts/a-studio/members/${editorId}`),
      adminCookie
    )
      .json({ role: 'owner' })
      .send()
    invalidPromotion.assertStatus(400)
    assert.equal((invalidPromotion.body() as { code: string }).code, 'OWNER_TRANSFER_REQUIRED')
    const ownerDemotion = await signed(
      client.patch(`/api/accounts/a-studio/members/${ownerId}`),
      adminCookie
    )
      .json({ role: 'editor' })
      .send()
    ownerDemotion.assertStatus(403)
    const unauthorized = await signed(
      client.patch(`/api/accounts/a-studio/members/${editorId}`),
      editor.cookie('adonis-session')!.value
    )
      .json({ role: 'owner' })
      .send()
    unauthorized.assertStatus(403)
    const unchangedMember = await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: editorId })
      .first()
    assert.equal(unchangedMember.role, 'editor')
    assert.lengthOf(await db.from('audit_entries').where({ action: 'member.role_changed' }), 0)
  })

  test('a stale but valid Admin session may create a company', async ({ client, assert }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const first = await signed(client.post('/api/orgs'), owner.cookie('adonis-session')!.value)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    first.assertStatus(201)
    const admin = await client
      .post('/api/auth/sign-up')
      .json({ email: 'diana.prince@wayne.example', password, name: 'Diana Prince' })
      .send()
    admin.assertStatus(201)
    const adminId = await userId('diana.prince@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-diana',
      account_id: 'a-studio',
      user_id: adminId,
      role: 'admin',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 16 * 60 * 1000
      const second = await signed(client.post('/api/orgs'), admin.cookie('adonis-session')!.value)
        .json({ id: 'a-loft', name: 'Stark Industries' })
        .send()
      second.assertStatus(201)
      assert.isNotNull(
        await db
          .from('memberships')
          .where({ account_id: 'a-loft', user_id: adminId, role: 'owner' })
          .first()
      )
    } finally {
      Date.now = realNow
    }
  })

  test('a stale but valid Owner may revoke self sessions but not another member sessions', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const cookie = owner.cookie('adonis-session')!.value
    const company = await signed(client.post('/api/orgs'), cookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    company.assertStatus(201)
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const ownerId = await userId('bruce.wayne@wayne.example')
    const editorId = await userId('clark.kent@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-clark',
      account_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 16 * 60 * 1000
      const other = await signed(
        client.post(`/api/accounts/a-studio/members/${editorId}/revoke-sessions`),
        cookie
      ).send()
      other.assertStatus(403)
      assert.equal((other.body() as { code: string }).code, 'SESSION_NOT_FRESH')
      const self = await signed(
        client.post(`/api/accounts/a-studio/members/${ownerId}/revoke-sessions`),
        cookie
      ).send()
      self.assertStatus(204)
    } finally {
      Date.now = realNow
    }
    assert.isNull(await db.from('user_session_index').where('user_id', ownerId).first())
    assert.isNotNull(await db.from('user_session_index').where('user_id', editorId).first())
  })

  test('an exact other-member session-revocation replay still requires a fresh session', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const cookie = owner.cookie('adonis-session')!.value
    const company = await signed(client.post('/api/orgs'), cookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    company.assertStatus(201)
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const editorId = await userId('clark.kent@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-clark',
      account_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const path = `/api/accounts/a-studio/members/${editorId}/revoke-sessions`
    const headers = {
      'x-account-command-id': 'revoke-editor-command-0001',
      'idempotency-key': 'revoke-editor-key-0001',
    }
    const first = await signed(client.post(path), cookie).headers(headers).send()
    first.assertStatus(204)
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 16 * 60 * 1000
      const replay = await signed(client.post(path), cookie).headers(headers).send()
      replay.assertStatus(403)
      assert.equal((replay.body() as { code: string }).code, 'SESSION_NOT_FRESH')
    } finally {
      Date.now = realNow
    }
  })

  test('tracking and explicit restriction survive restore until access is enabled', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const created = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    created.assertStatus(201)
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const editorCookie = editor.cookie('adonis-session')!.value
    const editorId = await userId('clark.kent@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-clark',
      account_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const directoryPath = '/api/accounts/a-studio/members'
    const initial = await signed(client.get(directoryPath), ownerCookie).send()
    initial.assertStatus(200)
    assert.isFalse(initial.body().signInTrackingEnabled)
    assert.isNull(
      initial.body().members.find((member: { userId: string }) => member.userId === editorId)
        .signInConfirmed
    )
    const enabled = await signed(
      client.put('/api/accounts/a-studio/member-sign-in-tracking'),
      ownerCookie
    )
      .json({ enabled: true })
      .send()
    enabled.assertStatus(200)
    const signedIn = await client
      .post('/api/auth/sign-in')
      .json({ email: 'clark.kent@wayne.example', password })
      .send()
    signedIn.assertStatus(200)
    const observed = await signed(client.get(directoryPath), ownerCookie).send()
    observed.assertStatus(200)
    assert.isTrue(
      observed.body().members.find((member: { userId: string }) => member.userId === editorId)
        .signInConfirmed
    )
    const statusPath = `/api/accounts/a-studio/members/${editorId}/status`
    const disabled = await signed(client.patch(statusPath), ownerCookie)
      .json({ status: 'disabled' })
      .send()
    disabled.assertStatus(200)
    const restored = await signed(client.patch(statusPath), ownerCookie)
      .json({ status: 'active' })
      .send()
    restored.assertStatus(200)
    const blocked = await signed(client.patch('/api/accounts/a-studio'), editorCookie)
      .json({ name: 'Blocked Edit' })
      .send()
    blocked.assertStatus(403)
    const access = await signed(
      client.post(`/api/accounts/a-studio/members/${editorId}/enable-access`),
      ownerCookie
    ).send()
    access.assertStatus(200)
    const allowed = await signed(client.patch('/api/accounts/a-studio'), editorCookie)
      .json({ name: 'Wayne Studio' })
      .send()
    allowed.assertStatus(200)
    const after = await signed(client.get(directoryPath), ownerCookie).send()
    after.assertStatus(200)
    assert.isFalse(
      after.body().members.find((member: { userId: string }) => member.userId === editorId)
        .signInConfirmed
    )
  })

  test('global sign-in does not confirm tracking in a restricted company', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    for (const account of [
      { id: 'a-studio', name: 'Wayne Enterprises' },
      { id: 'a-loft', name: 'Stark Industries' },
    ]) {
      const created = await signed(client.post('/api/orgs'), ownerCookie).json(account).send()
      created.assertStatus(201)
    }
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const editorId = await userId('clark.kent@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert(
      ['a-studio', 'a-loft'].map((accountId) => ({
        id: `member-clark-${accountId}`,
        account_id: accountId,
        user_id: editorId,
        role: 'editor',
        status: 'active',
        created_at: now,
        updated_at: now,
      }))
    )
    for (const accountId of ['a-studio', 'a-loft']) {
      const enabled = await signed(
        client.put(`/api/accounts/${accountId}/member-sign-in-tracking`),
        ownerCookie
      )
        .json({ enabled: true })
        .send()
      enabled.assertStatus(200)
    }
    const disabled = await signed(
      client.patch(`/api/accounts/a-studio/members/${editorId}/status`),
      ownerCookie
    )
      .json({ status: 'disabled' })
      .send()
    disabled.assertStatus(200)
    const signedIn = await client
      .post('/api/auth/sign-in')
      .json({ email: 'clark.kent@wayne.example', password })
      .send()
    signedIn.assertStatus(200)
    const observations = await db
      .from('company_settings')
      .where('key', `member-sign-in:${editorId}`)
      .select('account_id')
    assert.deepEqual(
      observations.map((row) => row.account_id),
      ['a-loft']
    )
  })

  test('restricted Admin cannot create a company or claim its capability until another active standing qualifies', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const first = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    first.assertStatus(201)
    const admin = await client
      .post('/api/auth/sign-up')
      .json({ email: 'diana.prince@wayne.example', password, name: 'Diana Prince' })
      .send()
    admin.assertStatus(201)
    const adminCookie = admin.cookie('adonis-session')!.value
    const adminId = await userId('diana.prince@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-diana-studio',
      account_id: 'a-studio',
      user_id: adminId,
      role: 'admin',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const available = await signed(client.get('/api/auth/me'), adminCookie).send()
    available.assertStatus(200)
    assert.isTrue(available.body().canCreateAccount)
    const disabled = await signed(
      client.patch(`/api/accounts/a-studio/members/${adminId}/status`),
      ownerCookie
    )
      .json({ status: 'disabled' })
      .send()
    disabled.assertStatus(200)
    const unavailable = await signed(client.get('/api/auth/me'), adminCookie).send()
    unavailable.assertStatus(200)
    assert.isFalse(unavailable.body().canCreateAccount)
    const refused = await signed(client.post('/api/orgs'), adminCookie)
      .json({ id: 'a-loft', name: 'Stark Industries' })
      .send()
    refused.assertStatus(403)
    assert.isNull(await db.from('accounts').where('id', 'a-loft').first())
    const second = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-loft', name: 'Stark Industries' })
      .send()
    second.assertStatus(201)
    await db.table('memberships').insert({
      id: 'member-diana-loft',
      account_id: 'a-loft',
      user_id: adminId,
      role: 'admin',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const restoredCapability = await signed(client.get('/api/auth/me'), adminCookie).send()
    restoredCapability.assertStatus(200)
    assert.isTrue(restoredCapability.body().canCreateAccount)
    const third = await signed(client.post('/api/orgs'), adminCookie)
      .json({ id: 'a-osc', name: 'Oscorp' })
      .send()
    third.assertStatus(201)
  })

  test('Disable and Enable Access preserve active, archived and removed membership lifecycle', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const company = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    company.assertStatus(201)
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const editorCookie = editor.cookie('adonis-session')!.value
    const editorId = await userId('clark.kent@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-clark',
      account_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const base = `/api/accounts/a-studio/members/${editorId}`
    const status = (value: string) =>
      signed(client.patch(`${base}/status`), ownerCookie)
        .json({ status: value })
        .send()
    const enable = () => signed(client.post(`${base}/enable-access`), ownerCookie).send()
    const membership = () =>
      db.from('memberships').where({ account_id: 'a-studio', user_id: editorId }).first()
    const membershipStatus = async () => {
      const member = await membership()
      return member?.status
    }
    const restriction = () =>
      db
        .from('account_access_restrictions')
        .where({ account_id: 'a-studio', principal_id: editorId })
        .first()

    const disabled = await status('disabled')
    disabled.assertStatus(200)
    assert.equal((disabled.body() as { status: string }).status, 'active')
    assert.equal(await membershipStatus(), 'active')
    assert.isNotNull(await restriction())
    await db.table('account_recovery_tokens').insert({
      user_id: editorId,
      email: 'clark.kent@wayne.example',
      token_hash: 'd'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: now,
    })
    const repeatedDisable = await status('disabled')
    repeatedDisable.assertStatus(200)
    assert.equal((repeatedDisable.body() as { status: string }).status, 'active')
    assert.isNotNull(await db.from('account_recovery_tokens').where('user_id', editorId).first())
    const disableAudits = await db
      .from('audit_entries')
      .where({ action: 'member.access_disabled', entity_id: editorId })
    assert.lengthOf(disableAudits, 1)
    const blocked = await signed(client.get('/api/state?accountId=a-studio'), editorCookie).send()
    blocked.assertStatus(403)
    const enabled = await enable()
    enabled.assertStatus(200)
    assert.equal(await membershipStatus(), 'active')
    assert.isNull(await restriction())
    const allowed = await signed(client.get('/api/state?accountId=a-studio'), editorCookie).send()
    allowed.assertStatus(200)

    const disabledAgain = await status('disabled')
    disabledAgain.assertStatus(200)
    const archived = await status('archived')
    archived.assertStatus(200)
    const enabledArchive = await enable()
    enabledArchive.assertStatus(200)
    assert.equal(await membershipStatus(), 'archived')
    assert.isNull(await restriction())
    const stillBlocked = await signed(
      client.get('/api/state?accountId=a-studio'),
      editorCookie
    ).send()
    stillBlocked.assertStatus(403)

    const disabledArchive = await status('disabled')
    disabledArchive.assertStatus(200)
    assert.equal((disabledArchive.body() as { status: string }).status, 'archived')
    assert.equal(await membershipStatus(), 'archived')
    const enabledArchiveAgain = await enable()
    enabledArchiveAgain.assertStatus(200)
    assert.equal(await membershipStatus(), 'archived')
    const disabledForRemoval = await status('disabled')
    disabledForRemoval.assertStatus(200)
    const removed = await signed(client.delete(base), ownerCookie).send()
    removed.assertStatus(204)
    assert.isNull(await membership())
    assert.isNotNull(await restriction())
    const enabledRemoved = await enable()
    enabledRemoved.assertStatus(200)
    assert.isNull(await membership())
    assert.isNull(await restriction())
  })

  test('failed Enable Access audit leaves an active membership restricted', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const company = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    company.assertStatus(201)
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const editorId = await userId('clark.kent@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-clark',
      account_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const disabled = await signed(
      client.patch(`/api/accounts/a-studio/members/${editorId}/status`),
      ownerCookie
    )
      .json({ status: 'disabled' })
      .send()
    disabled.assertStatus(200)
    await db.rawQuery(
      `CREATE TRIGGER fail_member_enable BEFORE INSERT ON audit_entries WHEN NEW.action = 'member.access_enabled' BEGIN SELECT RAISE(ABORT, 'forced enable audit failure'); END`
    )
    try {
      const failed = await signed(
        client.post(`/api/accounts/a-studio/members/${editorId}/enable-access`),
        ownerCookie
      ).send()
      assert.isAtLeast(failed.status(), 500)
      const member = await db
        .from('memberships')
        .where({ account_id: 'a-studio', user_id: editorId })
        .first()
      assert.equal(member.status, 'active')
      assert.isNotNull(
        await db
          .from('account_access_restrictions')
          .where({ account_id: 'a-studio', principal_id: editorId })
          .first()
      )
      assert.isNull(
        await db
          .from('audit_entries')
          .where({ action: 'member.access_enabled', entity_id: editorId })
          .first()
      )
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_member_enable')
    }
  })

  test('administrative reset issuance clears tracked sign-in atomically', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const created = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    created.assertStatus(201)
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const editorId = await userId('clark.kent@wayne.example')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-clark',
      account_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    await signed(client.put('/api/accounts/a-studio/member-sign-in-tracking'), ownerCookie)
      .json({ enabled: true })
      .send()
    const signIn = () =>
      client.post('/api/auth/sign-in').json({ email: 'clark.kent@wayne.example', password }).send()
    const signedIn = await signIn()
    signedIn.assertStatus(200)
    const observed = () =>
      db
        .from('company_settings')
        .where({ account_id: 'a-studio', key: `member-sign-in:${editorId}` })
        .first()
    assert.isNotNull(await observed())
    const oldToken = {
      user_id: editorId,
      email: 'clark.kent@wayne.example',
      token_hash: 'b'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: now,
    }
    await db.table('account_recovery_tokens').insert(oldToken)
    const resetPath = `/api/accounts/a-studio/members/${editorId}/reset-password`
    const headers = (suffix: string) => ({
      'x-account-command-id': `member-reset-command-${suffix}`,
      'idempotency-key': `member-reset-key-${suffix}`,
    })
    await db.rawQuery(
      `CREATE TRIGGER fail_tracking_clear BEFORE DELETE ON company_settings WHEN OLD.key = 'member-sign-in:${editorId}' BEGIN SELECT RAISE(ABORT, 'forced tracking clear failure'); END`
    )
    try {
      const failed = await signed(client.post(resetPath), ownerCookie)
        .headers(headers('fail'))
        .send()
      assert.isAtLeast(failed.status(), 500)
      assert.isNotNull(await observed())
      const retainedToken = await db
        .from('account_recovery_tokens')
        .where('user_id', editorId)
        .first()
      assert.equal(retainedToken.token_hash, oldToken.token_hash)
      assert.isNull(
        await db
          .from('command_results')
          .where('command_id', headers('fail')['x-account-command-id'])
          .first()
      )
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_tracking_clear')
    }
    const issued = await signed(client.post(resetPath), ownerCookie)
      .headers(headers('success'))
      .send()
    issued.assertStatus(201)
    assert.isNull(await observed())
    assert.isNotNull(await db.from('account_recovery_tokens').where('user_id', editorId).first())
    const duplicate = await signed(client.post(resetPath), ownerCookie)
      .headers(headers('success'))
      .send()
    duplicate.assertStatus(409)
    assert.equal((duplicate.body() as { code: string }).code, 'IDEMPOTENCY_CONFLICT')
  })
})
