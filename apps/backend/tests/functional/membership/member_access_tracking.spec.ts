import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { seed } from '@capacitylens/shared/data/seed'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { encodeRow, resetState } from '#services/state_repository'
import { acceptInvitation } from '#services/admission/invitations'
import { createFixtureCompanyForOwner } from '../../helpers/authenticated_data_fixture.js'

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

test.group('company member access and tracking', (group) => {
  group.setup(() => {
    const original = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      signup: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    return () => {
      env.set('CAPACITYLENS_MODE', original.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', original.setup)
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', original.signup)
    }
  })
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
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
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    )
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
    const planningPath = '/api/accounts/a-studio/planning'
    const blocked = await signed(client.get(planningPath), editorCookie).send()
    blocked.assertStatus(403)
    const access = await signed(
      client.post(`/api/accounts/a-studio/members/${editorId}/enable-access`),
      ownerCookie
    ).send()
    access.assertStatus(200)
    const allowed = await signed(client.get(planningPath), editorCookie).send()
    allowed.assertStatus(200)
    const after = await signed(client.get(directoryPath), ownerCookie).send()
    after.assertStatus(200)
    assert.isFalse(
      after.body().members.find((member: { userId: string }) => member.userId === editorId)
        .signInConfirmed
    )
  })

  test('Disable binds an alias only after current durable proof and rejects its readmission', async ({
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
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    )
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
    const disable = () =>
      signed(client.patch(`/api/accounts/a-studio/members/${editorId}/status`), ownerCookie)
        .json({ status: 'disabled' })
        .send()
    const restriction = () =>
      db
        .from('account_access_restrictions')
        .where({ account_id: 'a-studio', principal_id: editorId })
        .first()
    const first = await disable()
    first.assertStatus(200)
    const initialRestriction = await restriction()
    assert.isNull(initialRestriction?.verified_email)
    await db.from('users').where('id', editorId).update({ email_verified: true })
    const legacyFlagOnly = await disable()
    legacyFlagOnly.assertStatus(200)
    const unprovenRestriction = await restriction()
    assert.isNull(unprovenRestriction?.verified_email)
    await db.table('email_proofs').insert({
      id: 'proof-clark',
      user_id: editorId,
      email: 'clark.kent@wayne.example',
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    const proven = await disable()
    proven.assertStatus(200)
    const provenRestriction = await restriction()
    assert.equal(provenRestriction?.verified_email, 'clark.kent@wayne.example')
    const removed = await signed(
      client.delete(`/api/accounts/a-studio/members/${editorId}`),
      ownerCookie
    ).send()
    removed.assertStatus(204)
    await db.from('users').where('id', editorId).update({ email: 'kal-el@wayne.example' })
    await db.table('users').insert({
      id: 'alias-clark',
      email: 'clark.kent@wayne.example',
      email_verified: true,
      display_name: 'Clark Kent',
      created_at: now,
      updated_at: now,
    })
    await db.table('email_proofs').insert({
      id: 'proof-alias-clark',
      user_id: 'alias-clark',
      email: 'clark.kent@wayne.example',
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    await assert.rejects(
      () =>
        db.transaction((trx) =>
          acceptInvitation(
            trx,
            { account_id: 'a-studio', email: null },
            'alias-clark',
            'clark.kent@wayne.example'
          )
        ),
      /administrator restoration/
    )
    assert.isNull(
      await db.from('memberships').where({ account_id: 'a-studio', user_id: 'alias-clark' }).first()
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
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    )
    const now = new Date().toISOString()
    const otherCompany = { ...seed().accounts[0]!, id: 'a-loft', name: 'Stark Industries' }
    await db.table('accounts').insert(encodeRow('accounts', otherCompany))
    await db
      .table('clients')
      .insert(encodeRow('clients', { ...buildInternalClient('a-loft', now) }))
    const ownerMembership = await db.from('memberships').where({ account_id: 'a-studio' }).first()
    assert.isNotNull(ownerMembership)
    await db.table('memberships').insert({
      id: 'owner-loft',
      account_id: 'a-loft',
      user_id: ownerMembership.user_id,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const editor = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editor.assertStatus(201)
    const editorId = await userId('clark.kent@wayne.example')
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

  test('an Admin cannot create another company once the first company exists', async ({
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
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    )
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
    assert.isFalse(available.body().canCreateAccount)
    const refusedWhileActive = await signed(client.post('/api/orgs'), adminCookie)
      .json({ id: 'a-loft', name: 'Stark Industries' })
      .send()
    refusedWhileActive.assertStatus(404)
    assert.isNull(await db.from('accounts').where('id', 'a-loft').first())
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
    const refused = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-loft', name: 'Stark Industries' })
      .send()
    refused.assertStatus(404)
    assert.isNull(await db.from('accounts').where('id', 'a-loft').first())
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
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    )
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
    await db.table('password_reset_tokens').insert({
      tokenable_id: editorId,
      email: 'clark.kent@wayne.example',
      hash: 'd'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: now,
    })
    const repeatedDisable = await status('disabled')
    repeatedDisable.assertStatus(200)
    assert.equal((repeatedDisable.body() as { status: string }).status, 'active')
    assert.isNotNull(await db.from('password_reset_tokens').where('tokenable_id', editorId).first())
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
    const removedDirectory = await signed(
      client.get('/api/accounts/a-studio/members'),
      ownerCookie
    ).send()
    removedDirectory.assertStatus(200)
    const remembered = removedDirectory
      .body()
      .members.find((member: { userId: string }) => member.userId === editorId)
    assert.isDefined(remembered)
    assert.isFalse(remembered.membershipPresent)
    assert.isTrue(remembered.accessDisabled)
    assert.equal(remembered.status, 'disabled')
    assert.isFalse(remembered.mayResetPassword)
    assert.isFalse(remembered.mayRevokeSessions)
    const enabledRemoved = await enable()
    enabledRemoved.assertStatus(200)
    assert.isNull(await membership())
    assert.isNull(await restriction())
    const enabledDirectory = await signed(
      client.get('/api/accounts/a-studio/members'),
      ownerCookie
    ).send()
    enabledDirectory.assertStatus(200)
    assert.isUndefined(
      enabledDirectory
        .body()
        .members.find((member: { userId: string }) => member.userId === editorId)
    )
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
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    )
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
})
