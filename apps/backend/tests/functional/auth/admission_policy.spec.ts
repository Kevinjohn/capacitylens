import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { resetState } from '#services/state_repository'
import { policyAllowsAdmission } from '#services/admission/joining_policy'

const password = 'batman-secret-2026'
const setupToken = 'admission-policy-setup-0123456789'
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

test.group('joining policy and current proof', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('all four policies distinguish invitation, domain, and current proof', ({ assert }) => {
    const base = {
      email: 'clark.kent@wayne.example',
      hasCurrentProof: true,
      invitation: 'none' as const,
    }
    assert.isFalse(
      policyAllowsAdmission({
        ...base,
        settings: { policy: 'invitation_only', approvedDomains: [] },
      })
    )
    assert.isTrue(
      policyAllowsAdmission({
        ...base,
        invitation: 'addressed',
        settings: { policy: 'invitation_only', approvedDomains: [] },
      })
    )
    assert.isTrue(
      policyAllowsAdmission({ ...base, settings: { policy: 'open', approvedDomains: [] } })
    )
    assert.isFalse(
      policyAllowsAdmission({
        ...base,
        hasCurrentProof: false,
        settings: { policy: 'open', approvedDomains: [] },
      })
    )
    assert.isTrue(
      policyAllowsAdmission({
        ...base,
        settings: { policy: 'approved_domains', approvedDomains: ['wayne.example'] },
      })
    )
    assert.isFalse(
      policyAllowsAdmission({
        ...base,
        email: 'clark.kent@stark.example',
        settings: { policy: 'approved_domains', approvedDomains: ['wayne.example'] },
      })
    )
    assert.isTrue(
      policyAllowsAdmission({
        ...base,
        email: 'clark.kent@stark.example',
        invitation: 'addressed',
        settings: { policy: 'approved_domains_or_invitation', approvedDomains: ['wayne.example'] },
      })
    )
    assert.isTrue(
      policyAllowsAdmission({
        ...base,
        hasCurrentProof: false,
        invitation: 'addressed',
        settings: { policy: 'approved_domains_or_invitation', approvedDomains: ['wayne.example'] },
      })
    )
    assert.isTrue(
      policyAllowsAdmission({
        ...base,
        hasCurrentProof: false,
        invitation: 'addressed',
        settings: { policy: 'open', approvedDomains: [] },
      })
    )
    assert.isFalse(
      policyAllowsAdmission({
        ...base,
        hasCurrentProof: false,
        invitation: 'addressed',
        settings: { policy: 'approved_domains', approvedDomains: ['wayne.example'] },
      })
    )
  })

  test('owner policy update is scoped and direct join requires durable proof, not a legacy boolean', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      open: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
      check: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', prior.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', prior.setup)
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', prior.open)
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', prior.check)
    })
    const owner = await client
      .post('/api/auth/sign-up')
      .header('sec-fetch-site', 'same-origin')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', name: 'Bruce Wayne', password })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const company = await withSession(
      client.post('/api/orgs').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    company.assertStatus(201)
    const recruit = await client
      .post('/api/auth/sign-up')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'clark.kent@wayne.example', name: 'Clark Kent', password })
      .send()
    recruit.assertStatus(201)
    const recruitCookie = recruit.cookie('adonis-session')!.value
    const initial = await withSession(
      client.get('/api/accounts/a-studio/joining-policy'),
      ownerCookie
    ).send()
    initial.assertStatus(200)
    assert.equal(initial.body().policy, 'invitation_only')
    const updated = await withSession(
      client.put('/api/accounts/a-studio/joining-policy').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ policy: 'approved_domains', approvedDomains: ['wayne.example'] })
      .send()
    updated.assertStatus(200)
    const recruitUser = await db.from('users').where('email', 'clark.kent@wayne.example').first()
    const recruitId = recruitUser.id
    const issuedAt = new Date().toISOString()
    await db.table('account_recovery_tokens').insert({
      user_id: recruitId,
      email: 'clark.kent@wayne.example',
      token_hash: 'b'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: issuedAt,
    })
    await db.table('company_settings').insert({
      id: crypto.randomUUID(),
      account_id: 'a-studio',
      key: 'member-sign-in-tracking',
      value: JSON.stringify(true),
      created_at: issuedAt,
      updated_at: issuedAt,
    })
    await db.from('users').where('id', recruitId).update({ email_verified: true })
    const denied = await withSession(
      client
        .post('/api/accounts/a-studio/join/complete-existing')
        .header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({})
      .send()
    denied.assertStatus(401)
    assert.isNotNull(await db.from('account_recovery_tokens').where('user_id', recruitId).first())
    assert.isNull(
      await db.from('memberships').where({ account_id: 'a-studio', user_id: recruitId }).first()
    )
    const now = new Date().toISOString()
    await db.table('email_proofs').insert({
      id: crypto.randomUUID(),
      user_id: recruitId,
      email: 'clark.kent@wayne.example',
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    const joined = await withSession(
      client
        .post('/api/accounts/a-studio/join/complete-existing')
        .header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({})
      .send()
    joined.assertStatus(200)
    assert.equal(joined.body().role, 'viewer')
    assert.isNull(await db.from('account_recovery_tokens').where('user_id', recruitId).first())
    assert.isNotNull(
      await db
        .from('company_settings')
        .where({ account_id: 'a-studio', key: `member-sign-in:${recruitId}` })
        .first()
    )
    await db.table('account_recovery_tokens').insert({
      user_id: recruitId,
      email: 'clark.kent@wayne.example',
      token_hash: 'c'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: new Date().toISOString(),
    })
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: recruitId })
      .update({ role: 'admin' })
    const activeAgain = await withSession(
      client
        .post('/api/accounts/a-studio/join/complete-existing')
        .header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({})
      .send()
    activeAgain.assertStatus(200)
    assert.equal(activeAgain.body().role, 'admin')
    assert.isNotNull(await db.from('account_recovery_tokens').where('user_id', recruitId).first())
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: recruitId })
      .update({ status: 'disabled' })
    const disabled = await withSession(
      client
        .post('/api/accounts/a-studio/join/complete-existing')
        .header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({})
      .send()
    disabled.assertStatus(403)
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: recruitId })
      .update({ status: 'archived' })
    await db.rawQuery(
      `CREATE TRIGGER fail_join_audit BEFORE INSERT ON audit_entries WHEN NEW.action = 'membership.joined' BEGIN SELECT RAISE(ABORT, 'forced join audit failure'); END`
    )
    try {
      const rolledBack = await withSession(
        client
          .post('/api/accounts/a-studio/join/complete-existing')
          .header('sec-fetch-site', 'same-origin'),
        recruitCookie
      )
        .json({})
        .send()
      rolledBack.assertStatus(500)
      const archivedMember = await db
        .from('memberships')
        .where({ account_id: 'a-studio', user_id: recruitId })
        .first()
      assert.equal(archivedMember.status, 'archived')
      assert.isNotNull(await db.from('account_recovery_tokens').where('user_id', recruitId).first())
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_join_audit')
    }
    const archived = await withSession(
      client
        .post('/api/accounts/a-studio/join/complete-existing')
        .header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({})
      .send()
    archived.assertStatus(200)
    assert.equal(archived.body().role, 'viewer')
    assert.isNull(await db.from('account_recovery_tokens').where('user_id', recruitId).first())
    const refused = await withSession(
      client.put('/api/accounts/a-studio/joining-policy').header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({ policy: 'open', approvedDomains: [] })
      .send()
    refused.assertStatus(403)
    const invalid = await withSession(
      client.put('/api/accounts/a-studio/joining-policy').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ policy: 'approved_domains', approvedDomains: [] })
      .send()
    invalid.assertStatus(400)
    const stored = await db.from('account_joining_policies').where('account_id', 'a-studio').first()
    assert.equal(stored.policy, 'approved_domains')
  })
})
