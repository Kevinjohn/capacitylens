import { createHash, randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import router from '@adonisjs/core/services/router'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import { usersAdapter } from '#services/account_kit/users_adapter'
import { requestAdministrativeReset } from '#services/credentials/operations'

const setupToken = 'credential-admin-setup-token-2026'

// The member route is delivered in M3b; this test exercises the M3a service over real sessions.
router.post('/api/test/credential-admin-reset', async (ctx) => {
  const body = ctx.request.body() as {
    accountId: string
    targetUserId: string
    commandId: string
    idempotencyKey: string
  }
  try {
    return ctx.response.created(await requestAdministrativeReset({ ctx, ...body }))
  } catch (error) {
    const failure = error as { status?: number; code?: string }
    return ctx.response.status(failure.status ?? 500).send({ code: failure.code ?? 'UNEXPECTED' })
  }
})

function withSession<
  T extends { setup(callback: () => void): T; withCookie(name: string, value: string): T },
>(request: T, cookie: string): T {
  return request.setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

test.group('Administrative recovery issuance', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await db.from('audit_entries').delete()
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('accounts').delete()
    await db.from('users').delete()
  })
  group.each.teardown(async () => {
    await db.from('audit_entries').delete()
  })

  async function fixture(client: ApiClient) {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorSetup = env.get('CAPACITYLENS_SETUP_TOKEN')
    const priorScreen = env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK')
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    const email = `bruce-${randomUUID()}@wayne.example`
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password: 'owner-password-2026', name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const actorId = String(signUp.body().user.id)
    const cookie = signUp.cookie('adonis-session')!.value
    const accountId = randomUUID()
    const targetUserId = randomUUID()
    const now = new Date().toISOString()
    await db.table('accounts').insert({
      id: accountId,
      name: 'Wayne Enterprises',
      color: '#123456',
      created_at: now,
      updated_at: now,
    })
    await db.table('users').insert({
      id: targetUserId,
      email: `clark-${targetUserId}@wayne.example`,
      email_verified: true,
      password_hash: 'scrypt$N=131072,r=8,p=1$old$hash',
      display_name: 'Clark Kent',
      created_at: now,
      updated_at: now,
    })
    await db.table('memberships').insert([
      {
        id: randomUUID(),
        account_id: accountId,
        user_id: actorId,
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        account_id: accountId,
        user_id: targetUserId,
        role: 'editor',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ])
    return {
      cookie,
      actorId,
      accountId,
      targetUserId,
      restore() {
        env.set('CAPACITYLENS_MODE', priorMode ?? 'off')
        env.set('CAPACITYLENS_SETUP_TOKEN', priorSetup ?? '')
        env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', priorScreen)
      },
    }
  }

  test('captures the stored 24-hour link without email and rejects either command alias', async ({
    client,
    assert,
  }) => {
    const fake = mail.fake()
    const data = await fixture(client)
    try {
      const commandId = randomUUID()
      const idempotencyKey = randomUUID()
      const post = (overrides: Record<string, string> = {}) =>
        withSession(client.post('/api/test/credential-admin-reset'), data.cookie)
          .json({
            accountId: data.accountId,
            targetUserId: data.targetUserId,
            commandId,
            idempotencyKey,
            ...overrides,
          })
          .send()
      const issued = await post()
      issued.assertStatus(201)
      const { token, expiresAt } = issued.body() as { token: string; expiresAt: string }
      assert.lengthOf(token, 54)
      const stored = await db
        .from('password_reset_tokens')
        .where('tokenable_id', data.targetUserId)
        .first()
      assert.equal(stored?.hash, createHash('sha256').update(token).digest('hex'))
      assert.equal(expiresAt, String(stored?.expires_at))
      assert.isAtLeast(new Date(expiresAt).getTime() - Date.now(), 23 * 60 * 60 * 1000)
      fake.messages.assertNoneSent()
      const command = await db.from('command_results').where('command_id', commandId).first()
      assert.equal(command?.operation, `password-reset:actor:${data.actorId}`)
      assert.equal(command?.idempotency_key, idempotencyKey)
      assert.notInclude(JSON.stringify(command), token)
      const same = await post()
      const sameKey = await post({ commandId: randomUUID() })
      const sameId = await post({ idempotencyKey: randomUUID() })
      same.assertStatus(409)
      sameKey.assertStatus(409)
      sameId.assertStatus(409)
      const audits = await db.from('audit_entries').where('account_id', data.accountId)
      const commands = await db.from('command_results').where('account_id', data.accountId)
      assert.lengthOf(audits, 1)
      assert.lengthOf(commands, 1)
      const unchanged = await db
        .from('password_reset_tokens')
        .where('tokenable_id', data.targetUserId)
        .first()
      assert.equal(unchanged?.hash, stored?.hash)
    } finally {
      fake.messages.assertNoneSent()
      mail.restore()
      data.restore()
    }
  })

  test('a stale indexed session may request its own reset but not another member reset', async ({
    client,
    assert,
  }) => {
    const fake = mail.fake()
    const data = await fixture(client)
    const realNow = Date.now
    const post = (targetUserId: string) =>
      withSession(client.post('/api/test/credential-admin-reset'), data.cookie)
        .json({
          accountId: data.accountId,
          targetUserId,
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
        })
        .send()
    try {
      Date.now = () => realNow() + 16 * 60 * 1000
      const self = await post(data.actorId)
      self.assertStatus(201)
      assert.isNotNull(
        await db.from('password_reset_tokens').where('tokenable_id', data.actorId).first()
      )
      const other = await post(data.targetUserId)
      other.assertStatus(403)
      assert.equal(other.body().code, 'SESSION_NOT_FRESH')
      assert.isNull(
        await db.from('password_reset_tokens').where('tokenable_id', data.targetUserId).first()
      )
      fake.messages.assertNoneSent()
    } finally {
      Date.now = realNow
      mail.restore()
      data.restore()
    }
  })

  test('another-member issuance rechecks freshness inside the issuance transaction', async ({
    client,
    assert,
  }) => {
    const data = await fixture(client)
    const realNow = Date.now
    const findById = usersAdapter.findById
    try {
      usersAdapter.findById = async (id, trx) => {
        const user = await findById(id, trx)
        if (!trx && String(id) === data.targetUserId) Date.now = () => realNow() + 16 * 60 * 1000
        return user
      }
      const denied = await withSession(client.post('/api/test/credential-admin-reset'), data.cookie)
        .json({
          accountId: data.accountId,
          targetUserId: data.targetUserId,
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
        })
        .send()
      denied.assertStatus(403)
      assert.equal(denied.body().code, 'SESSION_NOT_FRESH')
      assert.isNull(
        await db.from('password_reset_tokens').where('tokenable_id', data.targetUserId).first()
      )
    } finally {
      usersAdapter.findById = findById
      Date.now = realNow
      data.restore()
    }
  })

  test('two first attempts at the last allowance mint once; completed aliases bypass the limiter', async ({
    client,
    assert,
  }) => {
    const fake = mail.fake()
    const data = await fixture(client)
    const post = (commandId: string, idempotencyKey: string) =>
      withSession(client.post('/api/test/credential-admin-reset'), data.cookie)
        .json({
          accountId: data.accountId,
          targetUserId: data.targetUserId,
          commandId,
          idempotencyKey,
        })
        .send()
    try {
      for (let index = 0; index < 4; index++) {
        const previous = await post(randomUUID(), randomUUID())
        previous.assertStatus(201)
      }
      const commandId = randomUUID()
      const idempotencyKey = randomUUID()
      const attempts = await Promise.all([
        post(commandId, idempotencyKey),
        post(commandId, idempotencyKey),
      ])
      assert.deepEqual(attempts.map((response) => response.status()).sort(), [201, 409])
      assert.lengthOf(await db.from('command_results').where('account_id', data.accountId), 5)
      assert.lengthOf(await db.from('audit_entries').where('account_id', data.accountId), 5)
      const duplicateByKey = await post(randomUUID(), idempotencyKey)
      duplicateByKey.assertStatus(409)
      const duplicateById = await post(commandId, randomUUID())
      duplicateById.assertStatus(409)
      const newAttempt = await post(randomUUID(), randomUUID())
      newAttempt.assertStatus(429)
      fake.messages.assertNoneSent()
    } finally {
      mail.restore()
      data.restore()
    }
  })

  test('role loss refuses issuance without claiming either command identity', async ({
    client,
    assert,
  }) => {
    const data = await fixture(client)
    const commandId = randomUUID()
    const idempotencyKey = randomUUID()
    const post = () =>
      withSession(client.post('/api/test/credential-admin-reset'), data.cookie)
        .json({
          accountId: data.accountId,
          targetUserId: data.targetUserId,
          commandId,
          idempotencyKey,
        })
        .send()
    try {
      await db
        .from('memberships')
        .where({ account_id: data.accountId, user_id: data.actorId })
        .update({ role: 'viewer' })
      const denied = await post()
      denied.assertStatus(403)
      assert.equal(denied.body().code, 'IDENTITY_AUTHORITY_DENIED')
      assert.isNotOk(
        await db.from('password_reset_tokens').where('tokenable_id', data.targetUserId).first()
      )
      assert.isNotOk(await db.from('command_results').where('command_id', commandId).first())
      await db
        .from('memberships')
        .where({ account_id: data.accountId, user_id: data.actorId })
        .update({ role: 'owner' })
      const issued = await post()
      issued.assertStatus(201)
    } finally {
      data.restore()
    }
  })

  test('concurrent administrative calls return only their own captured links', async ({
    client,
    assert,
  }) => {
    const data = await fixture(client)
    const otherUserId = randomUUID()
    const now = new Date().toISOString()
    try {
      await db.table('users').insert({
        id: otherUserId,
        email: `diana-${otherUserId}@wayne.example`,
        email_verified: true,
        password_hash: 'scrypt$N=131072,r=8,p=1$old$hash',
        display_name: 'Diana Prince',
        created_at: now,
        updated_at: now,
      })
      await db.table('memberships').insert({
        id: randomUUID(),
        account_id: data.accountId,
        user_id: otherUserId,
        role: 'editor',
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      const post = (targetUserId: string) =>
        withSession(client.post('/api/test/credential-admin-reset'), data.cookie)
          .json({
            accountId: data.accountId,
            targetUserId,
            commandId: randomUUID(),
            idempotencyKey: randomUUID(),
          })
          .send()
      const [first, second] = await Promise.all([post(data.targetUserId), post(otherUserId)])
      first.assertStatus(201)
      second.assertStatus(201)
      assert.notEqual(first.body().token, second.body().token)
      for (const [response, userId] of [
        [first, data.targetUserId],
        [second, otherUserId],
      ] as const) {
        const stored = await db.from('password_reset_tokens').where('tokenable_id', userId).first()
        assert.equal(stored?.hash, createHash('sha256').update(response.body().token).digest('hex'))
      }
    } finally {
      data.restore()
    }
  })

  test('a failed audit rolls issuance back without replacing a previous link or claiming the command', async ({
    client,
    assert,
  }) => {
    const fake = mail.fake()
    const data = await fixture(client)
    const post = (commandId: string, idempotencyKey: string) =>
      withSession(client.post('/api/test/credential-admin-reset'), data.cookie)
        .json({
          accountId: data.accountId,
          targetUserId: data.targetUserId,
          commandId,
          idempotencyKey,
        })
        .send()
    try {
      const first = await post(randomUUID(), randomUUID())
      first.assertStatus(201)
      const before = await db
        .from('password_reset_tokens')
        .where('tokenable_id', data.targetUserId)
        .first()
      const commandId = randomUUID()
      const idempotencyKey = randomUUID()
      await db.rawQuery(
        "CREATE TRIGGER credential_admin_audit_failure BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'audit failure'); END"
      )
      const failed = await post(commandId, idempotencyKey)
      assert.isAtLeast(failed.status(), 400)
      assert.deepEqual(
        await db.from('password_reset_tokens').where('tokenable_id', data.targetUserId).first(),
        before
      )
      assert.isNotOk(await db.from('command_results').where('command_id', commandId).first())
      await db.rawQuery('DROP TRIGGER credential_admin_audit_failure')
      const retry = await post(commandId, idempotencyKey)
      retry.assertStatus(201)
      assert.notEqual(retry.body().token, first.body().token)
      fake.messages.assertNoneSent()
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS credential_admin_audit_failure')
      mail.restore()
      data.restore()
    }
  })
})
