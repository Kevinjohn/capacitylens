import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { resetState } from '#services/state_repository'
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js'
import { signUpAndIn } from '../../helpers/identities.js'

const password = 'batman-secret-2026'

const signed = asDataOwner

async function userId(email: string) {
  const user = await db.from('users').where('email', email).first()
  if (!user) throw new Error(`Missing test principal: ${email}`)
  return String(user.id)
}

test.group('company member administration', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('account_admissions').delete()
    await db.from('account_invitations').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('role command replays its semantic result, binds payload and keeps recovery links', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      password,
      name: 'Bruce Wayne',
    })
    owner.assertStatus(200)
    const ownerCookie = owner.cookie('adonis-session')!.value
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    )
    const setupRevision = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first()
    assert.equal(Number(setupRevision?.revision), 1)
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    })
    editor.assertStatus(200)
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
    await db.table('password_reset_tokens').insert({
      tokenable_id: editorId,
      email: 'clark.kent@wayne.example',
      hash: 'a'.repeat(64),
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
    const changedRevision = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first()
    assert.equal(Number(changedRevision?.revision), 2)
    assert.isNotNull(
      await db.from('password_reset_tokens').where('tokenable_id', editorId).first(),
      'a role change never cancels identity recovery'
    )
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
    const unchanged = await signed(client.patch(path), ownerCookie)
      .headers({
        'x-account-command-id': 'member-role-command-noop-0001',
        'idempotency-key': 'member-role-idempotency-noop-0001',
      })
      .json({ role: 'admin' })
      .send()
    unchanged.assertStatus(200)
    const unchangedRevision = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first()
    assert.equal(Number(unchangedRevision?.revision), 2)
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
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      password,
      name: 'Bruce Wayne',
    })
    owner.assertStatus(200)
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    )
    const admin = await signUpAndIn(client, {
      email: 'diana.prince@wayne.example',
      password,
      name: 'Diana Prince',
    })
    admin.assertStatus(200)
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    })
    editor.assertStatus(200)
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

  test('a stale but valid Admin session cannot create another company', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      password,
      name: 'Bruce Wayne',
    })
    owner.assertStatus(200)
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    )
    const admin = await signUpAndIn(client, {
      email: 'diana.prince@wayne.example',
      password,
      name: 'Diana Prince',
    })
    admin.assertStatus(200)
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
      const cookie = admin.cookie('adonis-session')!.value
      const current = await signed(client.get('/api/auth/me'), cookie).send()
      current.assertStatus(200)
      assert.isFalse(current.body().canCreateAccount)
      const second = await signed(client.post('/api/orgs'), cookie)
        .json({ id: 'a-loft', name: 'Stark Industries' })
        .send()
      second.assertStatus(404)
      assert.isNull(await db.from('accounts').where('id', 'a-loft').first())
    } finally {
      Date.now = realNow
    }
  })
})
