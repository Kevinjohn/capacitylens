import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { seedLoginLinkProofs } from './login_link_fixtures.js'

function withSession<
  T extends { setup(callback: () => void): T; withCookie(name: string, value: string): T },
>(request: T, cookie: string): T {
  return request.setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

test.group('Credential HTTP contract', (group) => {
  group.setup(() => freshDatabase())

  test('public request is gated by mode and mail configuration', async ({
    client,
    assert,
    cleanup,
  }) => {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorHost = env.get('CAPACITYLENS_MAIL_HOST')
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', priorMode ?? 'password-only')
      env.set('CAPACITYLENS_MAIL_HOST', priorHost ?? '')
    })
    env.set('CAPACITYLENS_MODE', 'sso-only')
    env.set('CAPACITYLENS_MAIL_HOST', 'mail.example.test')
    const disabled = await client
      .post('/api/auth/request-reset')
      .json({ email: 'bruce@example.test' })
    assert.equal(disabled.status(), 404)
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_MAIL_HOST', '')
    const unavailable = await client
      .post('/api/auth/request-reset')
      .json({ email: 'bruce@example.test' })
    assert.equal(unavailable.status(), 404)
  })

  test('unknown and provider-only requests have the same acknowledgment and send no mail', async ({
    client,
    assert,
    cleanup,
  }) => {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorHost = env.get('CAPACITYLENS_MAIL_HOST')
    const fake = mail.fake()
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', priorMode ?? 'password-only')
      env.set('CAPACITYLENS_MAIL_HOST', priorHost ?? '')
      mail.restore()
    })
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_MAIL_HOST', 'mail.example.test')
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.table('users').insert({
      id,
      email: `${id}@example.test`,
      email_verified: true,
      password_hash: null,
      display_name: 'Clark Kent',
      created_at: now,
      updated_at: now,
    })
    const unknown = await client
      .post('/api/auth/request-reset')
      .json({ email: `unknown-${id}@example.test` })
    const provider = await client
      .post('/api/auth/request-reset')
      .json({ email: `${id}@example.test` })
    assert.equal(unknown.status(), 200)
    assert.equal(provider.status(), unknown.status())
    assert.deepEqual(provider.body(), unknown.body())
    fake.messages.assertNoneSent()
    assert.isNotOk(await db.from('password_reset_tokens').where('tokenable_id', id).first())
  })

  test('public recovery acknowledges while email delivery is still pending', async ({
    client,
    assert,
    cleanup,
  }) => {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorHost = env.get('CAPACITYLENS_MAIL_HOST')
    const originalSend = Object.getOwnPropertyDescriptor(mail, 'send')
    let releaseDelivery!: () => void
    const delivery = new Promise<void>((resolve) => {
      releaseDelivery = resolve
    })
    let deliveryStarted!: () => void
    const started = new Promise<void>((resolve) => {
      deliveryStarted = resolve
    })
    cleanup(() => {
      releaseDelivery()
      if (originalSend) Object.defineProperty(mail, 'send', originalSend)
      else Reflect.deleteProperty(mail, 'send')
      env.set('CAPACITYLENS_MODE', priorMode ?? 'password-only')
      env.set('CAPACITYLENS_MAIL_HOST', priorHost ?? '')
    })
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_MAIL_HOST', 'mail.example.test')
    Object.defineProperty(mail, 'send', {
      configurable: true,
      value: async () => {
        deliveryStarted()
        await delivery
      },
    })
    const id = crypto.randomUUID()
    const email = `${id}@wayne.example`
    const now = new Date().toISOString()
    await db.table('users').insert({
      id,
      email,
      email_verified: true,
      password_hash: 'scrypt$N=131072,r=8,p=1$old$hash',
      display_name: 'Bruce Wayne',
      created_at: now,
      updated_at: now,
    })
    const response = client.post('/api/auth/request-reset').json({ email }).send()
    await Promise.race([
      started,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Delivery did not start')), 2000)
      ),
    ])
    const outcome = await Promise.race([
      response.then(() => 'acknowledged'),
      new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 2000)),
    ])
    releaseDelivery()
    assert.equal(outcome, 'acknowledged')
    const result = await response
    result.assertStatus(200)
  })

  test('public recovery keeps a committed issuance neutral when cleanup and logging fail', async ({
    client,
    assert,
    cleanup,
  }) => {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorHost = env.get('CAPACITYLENS_MAIL_HOST')
    const fake = mail.fake()
    const sqliteClient = db.connection().getWriteClient().client as unknown as {
      acquireConnection(): Promise<{
        pragma(command: string, options?: { simple?: boolean }): unknown
        inTransaction: boolean
      }>
      releaseConnection(connection: unknown): Promise<void>
    }
    const sqlite = await sqliteClient.acquireConnection()
    const originalPragma = sqlite.pragma
    const originalError = Object.getOwnPropertyDescriptor(logger, 'error')
    let restorationFailed = false
    let diagnosticAttempts = 0
    sqlite.pragma = function (command, options) {
      const result = originalPragma.call(this, command, options)
      if (command === 'busy_timeout = 0') restorationFailed = false
      else if (command.startsWith('busy_timeout = ') && !this.inTransaction && !restorationFailed) {
        restorationFailed = true
        throw Object.assign(new Error('test-only post-commit cleanup failure'), {
          code: 'TEST_COMMIT_CLEANUP',
        })
      }
      return result
    }
    await sqliteClient.releaseConnection(sqlite)
    Object.defineProperty(logger, 'error', {
      configurable: true,
      value: () => {
        diagnosticAttempts++
        throw new Error('test-only diagnostic failure')
      },
    })
    cleanup(() => {
      sqlite.pragma = originalPragma
      if (originalError) Object.defineProperty(logger, 'error', originalError)
      else Reflect.deleteProperty(logger, 'error')
      env.set('CAPACITYLENS_MODE', priorMode ?? 'password-only')
      env.set('CAPACITYLENS_MAIL_HOST', priorHost ?? '')
      mail.restore()
    })
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_MAIL_HOST', 'mail.example.test')
    const id = crypto.randomUUID()
    const email = `${id}@wayne.example`
    const now = new Date().toISOString()
    await db.table('users').insert({
      id,
      email,
      email_verified: true,
      password_hash: 'scrypt$N=131072,r=8,p=1$old$hash',
      display_name: 'Bruce Wayne',
      created_at: now,
      updated_at: now,
    })
    const response = await client.post('/api/auth/request-reset').json({ email }).send()
    response.assertStatus(200)
    assert.deepEqual(response.body(), { ok: true })
    assert.isTrue(restorationFailed)
    assert.isAtLeast(diagnosticAttempts, 1)
    assert.isOk(await db.from('password_reset_tokens').where('tokenable_id', id).first())
    assert.notInclude(JSON.stringify(response.body()), 'TEST_COMMIT_CLEANUP')
    fake.messages.assertSentCount(1)
  })

  test('self change keeps the initiating session and honors other-session revocation choice', async ({
    client,
    assert,
    cleanup,
  }) => {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorSetup = env.get('CAPACITYLENS_SETUP_TOKEN')
    const priorScreen = env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK')
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', priorMode ?? 'password-only')
      env.set('CAPACITYLENS_SETUP_TOKEN', priorSetup ?? '')
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', priorScreen)
    })
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', 'credential-test-setup-token-2026')
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    await db.from('users').delete()
    const email = `bruce-${crypto.randomUUID()}@wayne.example`
    const original = 'old-password-2026-credentials'
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', 'credential-test-setup-token-2026')
      .json({ email, password: original, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const firstCookie = signUp.cookie('adonis-session')?.value
    assert.isString(firstCookie)
    const secondLogin = await client
      .post('/api/auth/sign-in')
      .json({ email, password: original })
      .send()
    secondLogin.assertStatus(200)
    const secondCookie = secondLogin.cookie('adonis-session')?.value
    assert.isString(secondCookie)
    assert.lengthOf(await db.from('user_session_index'), 2)

    const beforeChange = await db.from('users').where('email', email).first()
    const otherProof = await seedLoginLinkProofs(String(beforeChange!.id))
    const loginProof = await db
      .from('login_link_tokens')
      .where('tokenable_id', beforeChange!.id)
      .first()
    const beforeSessions = await db.from('user_session_index').orderBy('session_id')
    for (const length of [14, 129]) {
      const refused = await withSession(client.post('/api/auth/change-password'), firstCookie!)
        .json({
          currentPassword: original,
          newPassword: '🦇'.repeat(length),
          revokeOtherSessions: true,
        })
        .send()
      refused.assertStatus(400)
      assert.deepEqual(
        await db.from('login_link_tokens').where('tokenable_id', beforeChange!.id).first(),
        loginProof
      )
      assert.deepEqual(await db.from('users').where('email', email).first(), beforeChange)
      assert.deepEqual(await db.from('user_session_index').orderBy('session_id'), beforeSessions)
    }

    const firstChange = await withSession(client.post('/api/auth/change-password'), firstCookie!)
      .json({
        currentPassword: original,
        newPassword: '🦇'.repeat(128),
        revokeOtherSessions: false,
      })
      .send()
    firstChange.assertStatus(200)
    assert.isNotOk(
      await db.from('login_link_tokens').where('tokenable_id', beforeChange!.id).first()
    )
    assert.deepEqual(
      await db.from('login_link_tokens').where('tokenable_id', otherProof.tokenable_id).first(),
      otherProof
    )
    assert.lengthOf(await db.from('user_session_index'), 2)

    const secondChange = await withSession(client.post('/api/auth/change-password'), firstCookie!)
      .json({
        currentPassword: '🦇'.repeat(128),
        newPassword: 'final-password-2026-credentials',
        revokeOtherSessions: true,
      })
      .send()
    secondChange.assertStatus(200)
    assert.lengthOf(await db.from('user_session_index'), 1)
    const stillSignedIn = await withSession(client.get('/api/auth/me'), firstCookie!).send()
    stillSignedIn.assertStatus(200)
    const revoked = await withSession(client.get('/api/auth/me'), secondCookie!).send()
    revoked.assertStatus(401)
    const oldPassword = await client
      .post('/api/auth/sign-in')
      .json({ email, password: original })
      .send()
    oldPassword.assertStatus(401)
    const currentPassword = await client
      .post('/api/auth/sign-in')
      .json({ email, password: 'final-password-2026-credentials' })
      .send()
    currentPassword.assertStatus(200)
    assert.isString(currentPassword.cookie('adonis-session')?.value)
  })

  test('committed password change denies a revoked session when native cleanup fails', async ({
    client,
    assert,
    cleanup,
  }) => {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorSetup = env.get('CAPACITYLENS_SETUP_TOKEN')
    const priorScreen = env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK')
    cleanup(async () => {
      await db.rawQuery('DROP TRIGGER IF EXISTS credential_native_delete_failure')
      env.set('CAPACITYLENS_MODE', priorMode ?? 'password-only')
      env.set('CAPACITYLENS_SETUP_TOKEN', priorSetup ?? '')
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', priorScreen)
    })
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', 'credential-test-setup-token-2026')
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
    const email = `bruce-${crypto.randomUUID()}@wayne.example`
    const original = 'old-password-2026-credentials'
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', 'credential-test-setup-token-2026')
      .json({ email, password: original, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const firstCookie = signUp.cookie('adonis-session')!.value
    const secondLogin = await client
      .post('/api/auth/sign-in')
      .json({ email, password: original })
      .send()
    secondLogin.assertStatus(200)
    const secondCookie = secondLogin.cookie('adonis-session')!.value
    await db.rawQuery(
      "CREATE TRIGGER credential_native_delete_failure BEFORE DELETE ON adonis_sessions BEGIN SELECT RAISE(ABORT, 'native cleanup failure'); END"
    )
    const change = await withSession(client.post('/api/auth/change-password'), firstCookie)
      .json({
        currentPassword: original,
        newPassword: 'new-password-2026-credentials',
        revokeOtherSessions: true,
      })
      .send()
    change.assertStatus(503)
    assert.equal(
      (change.body() as { error?: string }).error,
      'Credential update completed, but a follow-up failed.'
    )
    assert.lengthOf(await db.from('user_session_index'), 1)
    const revoked = await withSession(client.get('/api/auth/me'), secondCookie).send()
    revoked.assertStatus(401)
    const current = await withSession(client.get('/api/auth/me'), firstCookie).send()
    current.assertStatus(200)
    await db.rawQuery('DROP TRIGGER credential_native_delete_failure')
    const currentLogin = await client
      .post('/api/auth/sign-in')
      .json({ email, password: 'new-password-2026-credentials' })
      .send()
    currentLogin.assertStatus(200)
  })
})
