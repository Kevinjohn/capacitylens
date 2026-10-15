import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { resetState } from '#services/state_repository'

const setupToken = 'admission-setup-token-0123456789'
const password = 'batman-secret-2026'

function withSession<
  T extends {
    setup(callback: (request: T) => void): T
    withCookie(name: string, value: string): T
  },
>(request: T, cookie: string) {
  return request.setup((prepared) => {
    prepared.withCookie('adonis-session', cookie)
  })
}

test.group('product invitation admission', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('anonymous preview is safe, accept requires a session, and a new principal joins once', async ({
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
    const cookie = owner.cookie('adonis-session')!.value
    const company = await withSession(
      client.post('/api/orgs').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    company.assertStatus(201)

    const created = await withSession(
      client.post('/api/invites').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ accountId: 'a-studio', role: 'viewer', preauthEmail: 'clark.kent@wayne.example' })
      .send()
    assert.equal(created.status(), 201, JSON.stringify(created.body()))
    const token = (created.body() as { token: string }).token
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    const persisted = await db.from('invitations').where('account_id', 'a-studio').first()
    assert.notEqual(persisted.token_hash, token)
    assert.notInclude(JSON.stringify(persisted), token)
    const openPolicy = await withSession(
      client.put('/api/accounts/a-studio/joining-policy').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ policy: 'open', approvedDomains: [] })
      .send()
    openPolicy.assertStatus(200)

    const preview = await client.get(`/api/invites/${token}/preview`).send()
    preview.assertStatus(200)
    assert.deepEqual(Object.keys(preview.body() as object).sort(), [
      'accountId',
      'accountName',
      'emailBound',
      'emailHint',
      'expiresAt',
      'role',
    ])
    assert.notInclude(JSON.stringify(preview.body()), 'clark.kent@wayne.example')
    assert.notInclude(JSON.stringify(preview.body()), token)
    const denied = await client.post(`/api/invites/${token}/accept`).send()
    denied.assertStatus(401)

    const wrongAddress = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .json({
        name: 'Barry Allen',
        email: 'barry.allen@wayne.example',
        password: 'flash-secret-2026',
      })
      .send()
    wrongAddress.assertStatus(400)
    assert.isNull(await db.from('users').where('email', 'barry.allen@wayne.example').first())
    const unclaimed = await db.from('invitations').where('id', persisted.id).first()
    assert.isNull(unclaimed.accepted_at)
    const weak = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .json({ name: 'Clark Kent', email: 'clark.kent@wayne.example', password: 'short' })
      .send()
    weak.assertStatus(400)
    assert.isNull(await db.from('users').where('email', 'clark.kent@wayne.example').first())

    const signupCommand = {
      'x-account-command-id': crypto.randomUUID(),
      'idempotency-key': crypto.randomUUID(),
    }
    const admitted = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .headers(signupCommand)
      .json({
        name: 'Clark Kent',
        email: 'clark.kent@wayne.example',
        password: 'superman-secret-2026',
      })
      .send()
    assert.equal(admitted.status(), 201, JSON.stringify(admitted.body()))
    assert.equal((admitted.body() as { ok: boolean }).ok, true)
    const user = await db.from('users').where('email', 'clark.kent@wayne.example').first()
    assert.isTrue(Boolean(user))
    const member = await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: user.id })
      .first()
    assert.equal(member.role, 'viewer')
    assert.equal(member.status, 'active')
    assert.isFalse(Boolean(user.email_verified))
    assert.isNull(await db.from('email_proofs').where('user_id', user.id).first())
    const replayed = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .headers(signupCommand)
      .json({
        name: 'Clark Kent',
        email: 'clark.kent@wayne.example',
        password: 'superman-secret-2026',
      })
      .send()
    replayed.assertStatus(201)
    assert.deepEqual(replayed.body(), admitted.body())
    const mismatch = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .headers(signupCommand)
      .json({
        name: 'Clark Kent',
        email: 'clark.kent@wayne.example',
        password: 'different-secret-2026',
      })
      .send()
    mismatch.assertStatus(409)
    const reused = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .json({
        name: 'Clark Kent',
        email: 'clark.kent@wayne.example',
        password: 'superman-secret-2026',
      })
      .send()
    assert.equal(reused.status(), 409, JSON.stringify(reused.body()))
    const originalFetch = globalThis.fetch
    let screeningCalls = 0
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', true)
    globalThis.fetch = async () => {
      screeningCalls += 1
      throw new Error('screening unavailable')
    }
    try {
      const unavailableReplay = await client
        .post(`/api/invites/${token}/signup`)
        .header('sec-fetch-site', 'same-origin')
        .headers(signupCommand)
        .json({
          name: 'Clark Kent',
          email: 'clark.kent@wayne.example',
          password: 'superman-secret-2026',
        })
        .send()
      unavailableReplay.assertStatus(201)
      assert.deepEqual(unavailableReplay.body(), admitted.body())
      assert.equal(screeningCalls, 0)
      const unavailableNewCommand = await client
        .post(`/api/invites/${token}/signup`)
        .header('sec-fetch-site', 'same-origin')
        .json({
          name: 'Clark Kent',
          email: 'clark.kent@wayne.example',
          password: 'superman-secret-2026',
        })
        .send()
      unavailableNewCommand.assertStatus(503)
      assert.equal(screeningCalls, 1)
    } finally {
      globalThis.fetch = originalFetch
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    }
    await db
      .from('invitations')
      .where('id', persisted.id)
      .update({ expires_at: '2000-01-01T00:00:00.000Z' })
    const expiredReplay = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .headers(signupCommand)
      .json({
        name: 'Clark Kent',
        email: 'clark.kent@wayne.example',
        password: 'superman-secret-2026',
      })
      .send()
    expiredReplay.assertStatus(201)
    assert.deepEqual(expiredReplay.body(), admitted.body())
    const expiredMismatch = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .headers(signupCommand)
      .json({
        name: 'Clark Kent',
        email: 'clark.kent@wayne.example',
        password: 'different-secret-2026',
      })
      .send()
    expiredMismatch.assertStatus(409)
    const expiredNewCommand = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .json({
        name: 'Clark Kent',
        email: 'clark.kent@wayne.example',
        password: 'superman-secret-2026',
      })
      .send()
    expiredNewCommand.assertStatus(410)
    assert.lengthOf(
      await db.from('memberships').where({ account_id: 'a-studio', user_id: user.id }),
      1
    )
  })
})
