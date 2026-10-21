import { createHash, randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { resetPassword } from '#services/credentials/operations'

function withSession<
  T extends { setup(callback: () => void): T; withCookie(name: string, value: string): T },
>(request: T, cookie: string) {
  return request.setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

test.group('new company recovery authority', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await db.from('audit_entries').delete()
    await db.from('command_results').delete()
    await db.from('memberships').delete()
    await db.from('accounts').delete()
    await db.from('user_session_index').delete()
    await db.from('users').delete()
  })
  group.each.teardown(async () => {
    await db.from('audit_entries').delete()
  })

  test('new Owner authority burns an old reset bearer once, while rollback preserves it', async ({
    client,
    assert,
    cleanup,
  }) => {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorSetup = env.get('CAPACITYLENS_SETUP_TOKEN')
    const priorScreen = env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK')
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', 'company-recovery-setup-token-2026')
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', priorMode)
      env.set('CAPACITYLENS_SETUP_TOKEN', priorSetup)
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', priorScreen)
    })
    const signed = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', 'company-recovery-setup-token-2026')
      .json({
        email: 'clark.kent@wayne.example',
        password: 'company-recovery-password-2026',
        name: 'Clark Kent',
      })
      .send()
    signed.assertStatus(201)
    const cookie = signed.cookie('adonis-session')!.value
    const userId = String(signed.body().user.id)
    const now = new Date().toISOString()
    const token = Buffer.alloc(32, 1).toString('base64url')
    const insertToken = async (value: string) =>
      db.table('password_reset_tokens').insert({
        tokenable_id: userId,
        email: 'clark.kent@wayne.example',
        hash: createHash('sha256').update(value).digest('hex'),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        created_at: now,
      })
    await insertToken(token)
    const create = (id: string, commandId: string, key: string, name = 'Wayne Enterprises') =>
      withSession(
        client
          .post('/api/orgs')
          .header('sec-fetch-site', 'same-origin')
          .header('x-account-command-id', commandId)
          .header('idempotency-key', key)
          .json({ id, name }),
        cookie
      )
    await db.rawQuery(
      "CREATE TRIGGER fail_new_owner BEFORE INSERT ON memberships WHEN NEW.account_id = 'a-failed' BEGIN SELECT RAISE(ABORT, 'test owner failure'); END"
    )
    try {
      const failed = await create('a-failed', randomUUID(), randomUUID()).send()
      assert.isAtLeast(failed.status(), 400)
      assert.isNull(await db.from('accounts').where('id', 'a-failed').first())
      assert.isNull(await db.from('memberships').where('account_id', 'a-failed').first())
      assert.isNull(await db.from('audit_entries').where('account_id', 'a-failed').first())
      assert.isNotNull(await db.from('password_reset_tokens').where('tokenable_id', userId).first())
    } finally {
      await db.rawQuery('DROP TRIGGER fail_new_owner')
    }
    const commandId = randomUUID()
    const key = randomUUID()
    const created = await create('a-studio', commandId, key).send()
    created.assertStatus(201)
    assert.isNull(await db.from('password_reset_tokens').where('tokenable_id', userId).first())
    await assert.rejects(() => resetPassword(token, 'replacement-password-2026'))
    const newStanding = await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: userId })
      .first()
    assert.equal(newStanding?.role, 'owner')
    const freshToken = Buffer.alloc(32, 2).toString('base64url')
    await insertToken(freshToken)
    const replay = await create('a-studio', commandId, key).send()
    replay.assertStatus(201)
    assert.isNotNull(await db.from('password_reset_tokens').where('tokenable_id', userId).first())
    const mismatch = await create('a-studio', commandId, key, 'Queen Consolidated').send()
    mismatch.assertStatus(409)
    assert.isNotNull(await db.from('password_reset_tokens').where('tokenable_id', userId).first())
    const storedCompany = await db.from('accounts').where('id', 'a-studio').first()
    assert.equal(storedCompany?.name, 'Wayne Enterprises')
  })
})
