import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { resetState } from '#services/state_repository'
import { createFixtureCompanyForOwner } from '../../helpers/authenticated_data_fixture.js'

const password = 'batman-secret-2026'
const setupToken = 'admission-existing-setup-0123456789'
const withSession = <
  T extends {
    setup(callback: (request: T) => void): T
    withCookie(name: string, value: string): T
  },
>(
  request: T,
  cookie: string
) =>
  request.setup((prepared) => {
    prepared.withCookie('adonis-session', cookie)
  })

test.group('existing-principal invitation lifecycle', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('wrong address cannot consume a link, existing principal joins, and Owner role survives its own invite', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      open: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
      check: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
      mail: env.get('CAPACITYLENS_MAIL_HOST'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    env.set('CAPACITYLENS_MAIL_HOST', '')
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', prior.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', prior.setup)
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', prior.open)
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', prior.check)
      env.set('CAPACITYLENS_MAIL_HOST', prior.mail ?? '')
    })
    const owner = await client
      .post('/api/auth/sign-up')
      .header('sec-fetch-site', 'same-origin')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', name: 'Bruce Wayne', password })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const ownerId = (owner.body() as { user: { id: string } }).user.id
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio')
    const recruit = await client
      .post('/api/auth/sign-up')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'clark.kent@wayne.example', name: 'Clark Kent', password })
      .send()
    recruit.assertStatus(201)
    const recruitCookie = recruit.cookie('adonis-session')!.value
    const recruitUser = await db.from('users').where('email', 'clark.kent@wayne.example').first()
    const recruitId = recruitUser.id
    const now = new Date().toISOString()
    await db.table('password_reset_tokens').insert({
      tokenable_id: recruitId,
      email: 'clark.kent@wayne.example',
      hash: 'a'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: now,
    })
    await db.table('company_settings').insert({
      id: crypto.randomUUID(),
      account_id: 'a-studio',
      key: 'member-sign-in-tracking',
      value: JSON.stringify(true),
      created_at: now,
      updated_at: now,
    })
    const created = await withSession(
      client.post('/api/invites').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ accountId: 'a-studio', role: 'editor', preauthEmail: 'clark.kent@wayne.example' })
      .send()
    created.assertStatus(201)
    const token = (created.body() as { token: string }).token
    const inviteId = (created.body() as { id: string }).id
    const orPolicy = await withSession(
      client.put('/api/accounts/a-studio/joining-policy').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ policy: 'approved_domains_or_invitation', approvedDomains: ['stark.example'] })
      .send()
    orPolicy.assertStatus(200)
    const wrong = await withSession(
      client.post(`/api/invites/${token}/accept`).header('sec-fetch-site', 'same-origin'),
      ownerCookie
    ).send()
    wrong.assertStatus(400)
    const unclaimed = await db.from('invitations').where('id', inviteId).first()
    assert.isNull(unclaimed.accepted_at)
    const acceptCommand = {
      'x-account-command-id': crypto.randomUUID(),
      'idempotency-key': crypto.randomUUID(),
    }
    const accepted = await withSession(
      client
        .post(`/api/invites/${token}/accept`)
        .header('sec-fetch-site', 'same-origin')
        .headers(acceptCommand),
      recruitCookie
    ).send()
    accepted.assertStatus(200)
    assert.equal((accepted.body() as unknown as { role: string }).role, 'editor')
    const membership = await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: recruitId })
      .first()
    assert.equal(membership.role, 'editor')
    const afterClaim = await db.from('users').where('id', recruitId).first()
    assert.isFalse(Boolean(afterClaim.email_verified))
    assert.isNull(await db.from('email_proofs').where('user_id', recruitId).first())
    assert.isNull(await db.from('password_reset_tokens').where('tokenable_id', recruitId).first())
    assert.isNotNull(
      await db
        .from('company_settings')
        .where({ account_id: 'a-studio', key: `member-sign-in:${recruitId}` })
        .first()
    )
    await db.table('accounts').insert({
      id: 'a-loft',
      name: 'Stark Industries',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    await db.table('account_joining_policies').insert({
      id: crypto.randomUUID(),
      account_id: 'a-loft',
      policy: 'open',
      approved_domains: '[]',
      created_at: now,
      updated_at: now,
    })
    const crossCompany = await withSession(
      client
        .post('/api/accounts/a-loft/join/complete-existing')
        .header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({})
      .send()
    crossCompany.assertStatus(401)
    assert.isNull(
      await db.from('memberships').where({ account_id: 'a-loft', user_id: recruitId }).first()
    )
    const replayed = await withSession(
      client
        .post(`/api/invites/${token}/accept`)
        .header('sec-fetch-site', 'same-origin')
        .headers(acceptCommand),
      recruitCookie
    ).send()
    replayed.assertStatus(200)
    assert.deepEqual(replayed.body(), accepted.body())
    const secondInvite = await withSession(
      client.post('/api/invites').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ accountId: 'a-studio', role: 'viewer', preauthEmail: 'clark.kent@wayne.example' })
      .send()
    secondInvite.assertStatus(201)
    const secondToken = (secondInvite.body() as unknown as { token: string }).token
    const mismatched = await withSession(
      client
        .post(`/api/invites/${secondToken}/accept`)
        .header('sec-fetch-site', 'same-origin')
        .headers(acceptCommand),
      recruitCookie
    ).send()
    mismatched.assertStatus(409)
    const secondId = (secondInvite.body() as unknown as { id: string }).id
    const secondRow = await db.from('invitations').where('id', secondId).first()
    assert.isNull(secondRow.accepted_at)
    const consumed = await withSession(
      client.post(`/api/invites/${token}/accept`).header('sec-fetch-site', 'same-origin'),
      recruitCookie
    ).send()
    consumed.assertStatus(409)
    await db
      .from('invitations')
      .where('id', inviteId)
      .update({ expires_at: '2000-01-01T00:00:00.000Z' })
    const expiredReplay = await withSession(
      client
        .post(`/api/invites/${token}/accept`)
        .header('sec-fetch-site', 'same-origin')
        .headers(acceptCommand),
      recruitCookie
    ).send()
    expiredReplay.assertStatus(200)
    assert.deepEqual(expiredReplay.body(), accepted.body())
    const expiredNewCommand = await withSession(
      client.post(`/api/invites/${token}/accept`).header('sec-fetch-site', 'same-origin'),
      recruitCookie
    ).send()
    expiredNewCommand.assertStatus(410)
    const viewerCreate = await withSession(
      client.post('/api/invites').header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({ accountId: 'a-studio', role: 'viewer', preauthEmail: 'barry.allen@wayne.example' })
      .send()
    viewerCreate.assertStatus(403)
    const own = await withSession(
      client.post('/api/invites').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ accountId: 'a-studio', role: 'viewer', preauthEmail: 'bruce.wayne@wayne.example' })
      .send()
    own.assertStatus(201)
    await db.table('password_reset_tokens').insert({
      tokenable_id: ownerId,
      email: 'bruce.wayne@wayne.example',
      hash: 'd'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: new Date().toISOString(),
    })
    const ownAccepted = await withSession(
      client
        .post(`/api/invites/${(own.body() as unknown as { token: string }).token}/accept`)
        .header('sec-fetch-site', 'same-origin'),
      ownerCookie
    ).send()
    ownAccepted.assertStatus(200)
    assert.equal((ownAccepted.body() as unknown as { role: string }).role, 'owner')
    assert.isNotNull(await db.from('password_reset_tokens').where('tokenable_id', ownerId).first())
    const listed = await withSession(
      client.get('/api/accounts/a-studio/invites').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    ).send()
    listed.assertStatus(200)
    const invites = (listed.body() as { invites: Array<{ id: string; usedAt: string | null }> })
      .invites
    assert.isTrue(invites.some((invite) => invite.id === inviteId && Boolean(invite.usedAt)))
    const deniedList = await withSession(
      client.get('/api/accounts/a-studio/invites').header('sec-fetch-site', 'same-origin'),
      recruitCookie
    ).send()
    deniedList.assertStatus(403)
    const revoked = await withSession(
      client
        .delete(`/api/accounts/a-studio/invites/${inviteId}`)
        .header('sec-fetch-site', 'same-origin'),
      ownerCookie
    ).send()
    revoked.assertStatus(204)
    assert.isNull(await db.from('invitations').where('id', inviteId).first())
    assert.lengthOf(
      await db
        .from('audit_entries')
        .where({ account_id: 'a-studio', action: 'invitation.revoked' }),
      1
    )
  })

  test('unknown, expired, corrupt, and secret-command repeat outcomes remain distinct', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      check: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
      mail: env.get('CAPACITYLENS_MAIL_HOST'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    env.set('CAPACITYLENS_MAIL_HOST', '')
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', prior.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', prior.setup)
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', prior.check)
      env.set('CAPACITYLENS_MAIL_HOST', prior.mail ?? '')
    })
    const owner = await client
      .post('/api/auth/sign-up')
      .header('sec-fetch-site', 'same-origin')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', name: 'Bruce Wayne', password })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const ownerId = (owner.body() as { user: { id: string } }).user.id
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio')
    const commandId = crypto.randomUUID()
    const idempotencyKey = crypto.randomUUID()
    const create = () =>
      withSession(
        client
          .post('/api/invites')
          .header('sec-fetch-site', 'same-origin')
          .header('x-account-command-id', commandId)
          .header('idempotency-key', idempotencyKey),
        ownerCookie
      )
        .json({ accountId: 'a-studio', role: 'viewer', preauthEmail: 'clark.kent@wayne.example' })
        .send()
    const first = await create()
    first.assertStatus(201)
    const repeated = await create()
    repeated.assertStatus(409)
    assert.equal((repeated.body() as unknown as { code: string }).code, 'IDEMPOTENCY_CONFLICT')
    assert.lengthOf(await db.from('invitations').where('account_id', 'a-studio'), 1)
    assert.lengthOf(
      await db
        .from('audit_entries')
        .where({ account_id: 'a-studio', action: 'invitation.created' }),
      1
    )
    const { token, id } = first.body() as unknown as { token: string; id: string }
    const unknown = await client.get(`/api/invites/${'a'.repeat(43)}/preview`).send()
    unknown.assertStatus(404)
    await db.from('invitations').where('id', id).update({ expires_at: '2000-01-01T00:00:00.000Z' })
    const expired = await client.get(`/api/invites/${token}/preview`).send()
    expired.assertStatus(410)
    await db.from('invitations').where('id', id).update({ expires_at: 'not-a-date' })
    const corrupt = await client.get(`/api/invites/${token}/preview`).send()
    corrupt.assertStatus(410)
  })
})
