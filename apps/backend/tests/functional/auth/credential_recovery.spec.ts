import { createHash, randomBytes } from 'node:crypto'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import { requestPublicReset, resetPassword } from '#services/credentials/operations'
import { verifyPassword } from '#services/password_service'

test.group('Account-kit recovery with product credentials', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorHost = env.get('CAPACITYLENS_MAIL_HOST')
    const priorScreen = env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK')
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_MAIL_HOST', 'mail.example.test')
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    return () => {
      env.set('CAPACITYLENS_MODE', priorMode ?? 'off')
      env.set('CAPACITYLENS_MAIL_HOST', priorHost ?? '')
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', priorScreen)
    }
  })

  test('refuses provider-only issuance without replacing an existing link, then redeems once', async ({
    assert,
  }) => {
    const fake = mail.fake()
    try {
      const id = crypto.randomUUID()
      const email = `${id}@example.test`
      const now = new Date().toISOString()
      const originalHash = 'scrypt$N=131072,r=8,p=1$old$hash'
      await db.table('users').insert({
        id,
        email,
        email_verified: false,
        password_hash: originalHash,
        display_name: 'Bruce Wayne',
        created_at: now,
        updated_at: now,
      })

      await requestPublicReset(email, `client-${id}`)
      await new Promise<void>((resolve) => setImmediate(resolve))
      fake.messages.assertSentCount(1)
      const link = String(fake.messages.sent()[0]?.nodeMailerMessage.text).match(
        /https?:\/\/\S+/
      )?.[0]
      assert.isString(link)
      const token = decodeURIComponent(new URL(link!).pathname.split('/').at(-1)!)
      assert.lengthOf(token, 54)
      const before = await db.from('password_reset_tokens').where('tokenable_id', id).first()
      assert.isOk(before)

      await db.from('users').where('id', id).update({ password_hash: null })
      await requestPublicReset(email, `provider-client-${id}`)
      assert.deepEqual(
        await db.from('password_reset_tokens').where('tokenable_id', id).first(),
        before
      )
      fake.messages.assertSentCount(1)
      const ineligible = await db.from('users').where('id', id).first()
      await assert.rejects(() => resetPassword(token, 'fresh-provider-password-2026'))
      assert.deepEqual(await db.from('users').where('id', id).first(), ineligible)
      assert.deepEqual(
        await db.from('password_reset_tokens').where('tokenable_id', id).first(),
        before
      )

      await db.from('users').where('id', id).update({ password_hash: originalHash })
      const replacement = 'correct-horse-battery-staple-2026'
      await resetPassword(token, replacement)
      const changed = await db.from('users').where('id', id).first()
      assert.isTrue(await verifyPassword(String(changed?.password_hash), replacement))
      assert.isTrue(Boolean(changed?.email_verified))
      assert.isNotOk(await db.from('password_reset_tokens').where('tokenable_id', id).first())
      await assert.rejects(() => resetPassword(token, replacement))
    } finally {
      mail.restore()
    }
  })

  test('rolls back credential, verification and token consumption when audit cannot commit', async ({
    assert,
  }) => {
    const fake = mail.fake()
    const id = crypto.randomUUID()
    const accountId = crypto.randomUUID()
    const email = `${id}@example.test`
    const now = new Date().toISOString()
    const originalHash = 'scrypt$N=131072,r=8,p=1$old$hash'
    try {
      await db.table('users').insert({
        id,
        email,
        email_verified: false,
        password_hash: originalHash,
        display_name: 'Bruce Wayne',
        created_at: now,
        updated_at: now,
      })
      await db.table('accounts').insert({
        id: accountId,
        name: 'Wayne Enterprises',
        color: '#123456',
        created_at: now,
        updated_at: now,
      })
      await db.table('memberships').insert({
        id: crypto.randomUUID(),
        account_id: accountId,
        user_id: id,
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      const sessionId = `session-${id}`
      await db.table('user_session_index').insert({
        user_id: id,
        session_id: sessionId,
        authenticated_at: Date.now(),
        last_activity_at: Date.now(),
      })
      await requestPublicReset(email, `rollback-client-${id}`)
      await new Promise<void>((resolve) => setImmediate(resolve))
      const text = String(fake.messages.sent()[0]?.nodeMailerMessage.text)
      const link = text.match(/https?:\/\/\S+/)?.[0]
      assert.isString(link)
      const token = decodeURIComponent(new URL(link!).pathname.split('/').at(-1)!)
      const before = await db.from('password_reset_tokens').where('tokenable_id', id).first()
      assert.isOk(before)

      await db.rawQuery(
        "CREATE TRIGGER credential_audit_failure BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'audit failure'); END"
      )
      await assert.rejects(() => resetPassword(token, 'fresh-recovery-password-2026'))
      const unchanged = await db.from('users').where('id', id).first()
      assert.equal(unchanged?.password_hash, originalHash)
      assert.isFalse(Boolean(unchanged?.email_verified))
      assert.deepEqual(
        await db.from('password_reset_tokens').where('tokenable_id', id).first(),
        before
      )
      assert.isNotOk(await db.from('audit_entries').where('account_id', accountId).first())
      assert.isOk(await db.from('user_session_index').where('session_id', sessionId).first())
      await db.rawQuery('DROP TRIGGER credential_audit_failure')
      await resetPassword(token, 'fresh-recovery-password-2026')
      const changed = await db.from('users').where('id', id).first()
      assert.isTrue(
        await verifyPassword(String(changed?.password_hash), 'fresh-recovery-password-2026')
      )
      assert.isOk(await db.from('audit_entries').where('account_id', accountId).first())
      assert.isNotOk(await db.from('user_session_index').where('session_id', sessionId).first())
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS credential_audit_failure')
      mail.restore()
    }
  })
  test('redeems canonical legacy proofs once and keeps invalid passwords from consuming proofs', async ({
    assert,
    client,
    cleanup,
  }) => {
    mail.fake()
    cleanup(() => mail.restore())
    const id = crypto.randomUUID()
    const email = `${id}@example.test`
    const now = new Date().toISOString()
    await db.table('users').insert({
      id,
      email,
      email_verified: true,
      password_hash: 'old-credential',
      display_name: 'Diana Prince',
      created_at: now,
      updated_at: now,
    })
    const token = randomBytes(32).toString('base64url')
    assert.lengthOf(token, 43)
    await db.table('password_reset_tokens').insert({
      tokenable_id: id,
      email,
      hash: createHash('sha256').update(token).digest('hex'),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      created_at: now,
    })
    const before = await db.from('password_reset_tokens').where('tokenable_id', id).first()
    const user = await db.from('users').where('id', id).first()
    for (const length of [14, 129]) {
      const refused = await client
        .post('/api/auth/reset-password')
        .json({ token, newPassword: '🦇'.repeat(length) })
      refused.assertStatus(400)
      assert.deepEqual(
        await db.from('password_reset_tokens').where('tokenable_id', id).first(),
        before
      )
      assert.deepEqual(await db.from('users').where('id', id).first(), user)
    }
    const password = '🦇'.repeat(128)
    const redeemed = await client
      .post('/api/auth/reset-password')
      .json({ token, newPassword: password })
    redeemed.assertStatus(200)
    const changed = await db.from('users').where('id', id).first()
    assert.isTrue(await verifyPassword(changed!.password_hash, password))
    assert.equal(changed!.email, email)
    assert.isTrue(Boolean(changed!.email_verified))
    await assert.rejects(() => resetPassword(token, password))
    await db
      .table('password_reset_tokens')
      .insert({ ...before, expires_at: new Date(Date.now() - 3600000).toISOString() })
    const expired = await db.from('password_reset_tokens').where('tokenable_id', id).first()
    await assert.rejects(() => resetPassword(token, password))
    assert.deepEqual(
      await db.from('password_reset_tokens').where('tokenable_id', id).first(),
      expired
    )
    assert.deepEqual(await db.from('users').where('id', id).first(), changed)
  })
})
