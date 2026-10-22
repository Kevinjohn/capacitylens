import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { createFixtureCompanyForOwner } from '../../helpers/authenticated_data_fixture.js'
import env from '#start/env'
import { resetState } from '#services/state_repository'

const password = 'batman-secret-2026'
const setupToken = 'admission-resource-setup-0123456789'
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

test.group('invitation person proposal settlement', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('proposal remains private and non-reserving, then links the admitted member atomically', async ({
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
      env.set('CAPACITYLENS_MAIL_HOST', prior.mail)
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
    const now = new Date().toISOString()
    await db.table('resources').insert({
      id: 'r-clark',
      account_id: 'a-studio',
      kind: 'person',
      name: 'Clark Kent',
      role: 'Designer',
      avatar_url: 'https://images.example/clark.png',
      employment_type: 'permanent',
      engagement: 'studio',
      working_hours_per_day: 8,
      working_days: '[1,2,3,4,5]',
      half_days: '[]',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    const created = await withSession(
      client.post('/api/invites').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({
        accountId: 'a-studio',
        role: 'editor',
        preauthEmail: 'clark.kent@wayne.example',
        proposedResourceId: 'r-clark',
      })
      .send()
    created.assertStatus(201)
    const token = (created.body() as { token: string }).token
    assert.isNull(await db.from('account_member_resources').where('resource_id', 'r-clark').first())
    const preview = await client.get(`/api/invites/${token}/preview`).send()
    preview.assertStatus(200)
    assert.notInclude(JSON.stringify(preview.body()), 'r-clark')
    assert.notInclude(JSON.stringify(preview.body()), 'Clark Kent')
    const admitted = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .json({
        email: 'clark.kent@wayne.example',
        name: 'Clark Kent',
        password: 'superman-secret-2026',
      })
      .send()
    admitted.assertStatus(201)
    const recruitUser = await db.from('users').where('email', 'clark.kent@wayne.example').first()
    const recruitId = recruitUser.id
    const link = await db
      .from('account_member_resources')
      .where({ account_id: 'a-studio', user_id: recruitId })
      .first()
    assert.equal(link.resource_id, 'r-clark')
    const avatars = await withSession(
      client.get('/api/accounts/a-studio/resource-avatars'),
      ownerCookie
    ).send()
    avatars.assertStatus(200)
    assert.deepEqual(avatars.body(), {
      avatars: [{ resourceId: 'r-clark', imageUrl: 'https://images.example/clark.png' }],
    })
    const stale = await withSession(
      client
        .put(`/api/accounts/a-studio/members/${recruitId}/resource-link`)
        .header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ resourceId: 'r-clark', expectedRevision: 'stale' })
      .send()
    stale.assertStatus(409)
    const cleared = await withSession(
      client
        .delete(`/api/accounts/a-studio/members/${recruitId}/resource-link`)
        .header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ expectedRevision: link.revision })
      .send()
    cleared.assertStatus(204)
    assert.isNull(
      await db
        .from('account_member_resources')
        .where({ account_id: 'a-studio', user_id: recruitId })
        .first()
    )
  })

  test('a cross-company proposal rolls back the new principal, claim, audit and membership', async ({
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
      env.set('CAPACITYLENS_MAIL_HOST', prior.mail)
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
    const now = new Date().toISOString()
    await db.table('accounts').insert({
      id: 'a-loft',
      name: 'Stark Industries',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    await db.table('resources').insert({
      id: 'r-clark',
      account_id: 'a-studio',
      kind: 'person',
      name: 'Clark Kent',
      role: 'Designer',
      employment_type: 'permanent',
      engagement: 'studio',
      working_hours_per_day: 8,
      working_days: '[1,2,3,4,5]',
      half_days: '[]',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    const created = await withSession(
      client.post('/api/invites').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({
        accountId: 'a-studio',
        role: 'viewer',
        preauthEmail: 'clark.kent@wayne.example',
        proposedResourceId: 'r-clark',
      })
      .send()
    created.assertStatus(201)
    const token = (created.body() as { token: string }).token
    const inviteId = (created.body() as { id: string }).id
    await db.table('resources').insert({
      id: 'r-stark',
      account_id: 'a-loft',
      kind: 'person',
      name: 'Tony Stark',
      role: 'Designer',
      employment_type: 'permanent',
      engagement: 'studio',
      working_hours_per_day: 8,
      working_days: '[1,2,3,4,5]',
      half_days: '[]',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    await db
      .from('invitation_proposals')
      .where('invitation_id', inviteId)
      .update({ resource_id: 'r-stark' })
    const listed = await withSession(
      client.get('/api/accounts/a-studio/invites').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    ).send()
    listed.assertStatus(200)
    assert.notInclude(JSON.stringify(listed.body()), 'Tony Stark')
    const attempted = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .json({
        email: 'clark.kent@wayne.example',
        name: 'Clark Kent',
        password: 'superman-secret-2026',
      })
      .send()
    attempted.assertStatus(500)
    assert.isNull(await db.from('users').where('email', 'clark.kent@wayne.example').first())
    assert.isNull(
      await db.from('memberships').where('account_id', 'a-studio').whereNot('role', 'owner').first()
    )
    assert.isNull(
      await db.from('invitations').where({ id: inviteId }).whereNotNull('accepted_at').first()
    )
    assert.isNull(
      await db
        .from('audit_entries')
        .where({ account_id: 'a-studio', action: 'invitation.accepted' })
        .first()
    )
    assert.isNull(await db.from('account_member_resources').where('resource_id', 'r-clark').first())
    assert.isNull(
      await db.from('command_results').where('operation', 'like', '%signup-invitation%').first()
    )
  })
})
