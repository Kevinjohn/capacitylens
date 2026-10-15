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
      const before = await db.from('account_recovery_tokens').where('user_id', id).first()
      assert.isOk(before)

      await db.from('users').where('id', id).update({ password_hash: null })
      await requestPublicReset(email, `provider-client-${id}`)
      assert.deepEqual(
        await db.from('account_recovery_tokens').where('user_id', id).first(),
        before
      )
      fake.messages.assertSentCount(1)

      await db.from('users').where('id', id).update({ password_hash: originalHash })
      const replacement = 'correct-horse-battery-staple-2026'
      await resetPassword(token, replacement)
      const changed = await db.from('users').where('id', id).first()
      assert.isTrue(await verifyPassword(String(changed?.password_hash), replacement))
      assert.isTrue(Boolean(changed?.email_verified))
      assert.isNotOk(await db.from('account_recovery_tokens').where('user_id', id).first())
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
      const before = await db.from('account_recovery_tokens').where('user_id', id).first()
      assert.isOk(before)

      await db.rawQuery(
        "CREATE TRIGGER credential_audit_failure BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'audit failure'); END"
      )
      await assert.rejects(() => resetPassword(token, 'fresh-recovery-password-2026'))
      const unchanged = await db.from('users').where('id', id).first()
      assert.equal(unchanged?.password_hash, originalHash)
      assert.isFalse(Boolean(unchanged?.email_verified))
      assert.deepEqual(
        await db.from('account_recovery_tokens').where('user_id', id).first(),
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
})
