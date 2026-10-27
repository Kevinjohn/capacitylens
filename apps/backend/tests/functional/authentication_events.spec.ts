import { test } from '@japa/runner'
import { LoggerFactory } from '@adonisjs/logger/factories'
import logger from '@adonisjs/core/services/logger'
import loggerConfig from '#config/logger'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import accountKit from 'adonisjs-account-kit/services/main'
import type { AccountUser } from 'adonisjs-account-kit/types'
import { DateTime } from 'luxon'
import { freshDatabase } from '../helpers/fresh_database.js'
import { createIdentity, clearIdentities } from '../helpers/identities.js'
import { createFixtureCompanyForOwner } from '../helpers/authenticated_data_fixture.js'
import limiter from '@adonisjs/limiter/services/main'
import { resetState } from '#services/state_repository'

const email = 'bruce.wayne@wayne.example'
const password = 'batman-secret-2026'

async function captureLogs<T>(work: () => Promise<T>) {
  const lines: string[] = []
  const capture = new LoggerFactory()
    .merge({ ...loggerConfig.loggers.app, level: 'trace' })
    .pushLogsTo(lines)
    .create()
  const originalChild = logger.child
  const instrument = (
    child: ReturnType<typeof capture.child>
  ): ReturnType<typeof capture.child> => {
    const nestedChild = child.child
    child.child = ((...args: Parameters<typeof child.child>) =>
      instrument(nestedChild.apply(child, args))) as typeof child.child
    return child
  }
  logger.child = ((...args: Parameters<typeof logger.child>) =>
    instrument(capture.child(...args))) as typeof logger.child
  try {
    return { lines, result: await work() }
  } finally {
    logger.child = originalChild
  }
}

test.group('authentication outcome events', (group) => {
  const originalLogging = env.get('CAPACITYLENS_LOG')

  group.setup(() => freshDatabase())
  group.setup(() => env.set('CAPACITYLENS_LOG', '1'))
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
    await limiter.clear()
  })
  group.teardown(() => {
    env.set('CAPACITYLENS_LOG', originalLogging ?? '')
    if (originalLogging === undefined) delete process.env.CAPACITYLENS_LOG
  })

  test('records successful and rejected sign-in outcomes without credentials or identifiers', async ({
    client,
    assert,
  }) => {
    await createIdentity(email, { name: 'Bruce Wayne', password })
    const sentinels = {
      password,
      email,
      userAgent: 'private-agent-sentinel/1',
      ip: '198.51.100.77',
    }
    const { lines } = await captureLogs(async () => {
      const success = await client
        .post('/api/auth/sign-in')
        .header('user-agent', sentinels.userAgent)
        .header('x-forwarded-for', sentinels.ip)
        .json({ email, password })
        .send()
      success.assertStatus(200)
      const failure = await client
        .post('/api/auth/sign-in')
        .header('user-agent', sentinels.userAgent)
        .header('x-forwarded-for', sentinels.ip)
        .json({ email, password: 'incorrect-private-password' })
        .send()
      failure.assertStatus(401)
    })

    const output = lines.join('\n')
    const entries = lines.map((line) => JSON.parse(line))
    const authEvents = entries.filter((entry) => entry.event === 'auth.sign_in')
    assert.deepEqual(authEvents.map((entry) => entry.outcome).sort(), ['failure', 'success'])
    for (const event of authEvents) {
      assert.match(event.correlationId, /^[a-z0-9]+-[a-z0-9]+$/)
      assert.isTrue(
        entries.some(
          (entry) =>
            entry.event === 'http.request.completed' && entry.correlationId === event.correlationId
        ),
        'sign-in event shares its request completion correlation ID'
      )
    }
    for (const secret of [
      sentinels.password,
      sentinels.email,
      sentinels.userAgent,
      sentinels.ip,
      'incorrect-private-password',
    ]) {
      assert.notInclude(output, secret)
    }
  })

  test('records throttled sign-in outcomes without changing the refusal', async ({
    client,
    assert,
  }) => {
    const request = () =>
      client
        .post('/api/auth/sign-in')
        .json({ email: 'private-throttle@example.test', password: 'never-store-this-password' })
        .send()
    const { lines, result } = await captureLogs(async () => {
      for (let attempt = 0; attempt < 5; attempt++) await request()
      return request()
    })

    assert.equal(result.status(), 429)
    const entries = lines.map((line) => JSON.parse(line))
    const authEvents = entries.filter((entry) => entry.event === 'auth.sign_in')
    assert.lengthOf(authEvents, 6)
    assert.deepEqual(
      authEvents.map((entry) => entry.outcome),
      ['failure', 'failure', 'failure', 'failure', 'failure', 'throttled']
    )
    const throttled = authEvents[5]
    assert.match(throttled.correlationId, /^[a-z0-9]+-[a-z0-9]+$/)
    assert.isTrue(
      entries.some(
        (entry) =>
          entry.event === 'http.request.completed' &&
          entry.correlationId === throttled.correlationId &&
          entry.status === 429
      ),
      'throttle event shares its 429 request completion correlation ID'
    )
    assert.notInclude(lines.join('\n'), 'private-throttle@example.test')
    assert.notInclude(lines.join('\n'), 'never-store-this-password')
  })

  test('records Account Kit login for automatic sign-in after registration', async ({
    client,
    assert,
    cleanup,
  }) => {
    const ownerId = await createIdentity('bruce.wayne@wayne.example', {
      name: 'Bruce Wayne',
      password,
    })
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio')
    const signupEmail = 'clark.kent@wayne.example'
    await createIdentity(signupEmail, { name: 'Clark Kent', password })

    const previousSignup = env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP')
    const originalRegister = accountKit.registration.register
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    accountKit.registration.register = async () =>
      ({
        id: 'test-registration',
        email: signupEmail,
        unverifiedEmail: null,
        hasPassword: true,
        emailVerifiedAt: DateTime.now(),
      }) satisfies AccountUser
    cleanup(() => {
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', previousSignup)
      accountKit.registration.register = originalRegister
    })

    const { lines, result } = await captureLogs(async () =>
      client
        .post('/api/auth/sign-up')
        .json({ email: signupEmail, password, name: 'Clark Kent' })
        .send()
    )

    result.assertStatus(201)
    const entries = lines.map((line) => JSON.parse(line))
    const authEvent = entries.find((entry) => entry.event === 'auth.sign_in')
    assert.isDefined(authEvent)
    assert.equal(authEvent.outcome, 'success')
    assert.isTrue(
      entries.some(
        (entry) =>
          entry.event === 'http.request.completed' &&
          entry.correlationId === authEvent.correlationId &&
          entry.status === 201
      )
    )
    assert.notInclude(lines.join('\n'), signupEmail)
    assert.notInclude(lines.join('\n'), password)
  })

  test('keeps the successful login event when post-login tracking fails', async ({
    client,
    assert,
    cleanup,
  }) => {
    const userId = await createIdentity(email, { name: 'Bruce Wayne', password })
    await createFixtureCompanyForOwner(userId, 'Wayne Enterprises', 'a-studio')
    const now = new Date().toISOString()
    await db.table('company_settings').insert({
      id: 'test-sign-in-tracking',
      account_id: 'a-studio',
      key: 'member-sign-in-tracking',
      value: JSON.stringify(true),
      created_at: now,
      updated_at: now,
    })
    await db.rawQuery(`
      CREATE TRIGGER fail_sign_in_tracking
      BEFORE INSERT ON company_settings
      WHEN NEW.key LIKE 'member-sign-in:%'
      BEGIN SELECT RAISE(ABORT, 'sign-in tracking failure'); END
    `)
    cleanup(() => db.rawQuery('DROP TRIGGER IF EXISTS fail_sign_in_tracking'))

    const { lines, result } = await captureLogs(() =>
      client.post('/api/auth/sign-in').json({ email, password }).send()
    )

    result.assertStatus(500)
    const entries = lines.map((line) => JSON.parse(line))
    const authEvent = entries.find((entry) => entry.event === 'auth.sign_in')
    assert.isDefined(authEvent)
    assert.equal(authEvent.outcome, 'success')
    assert.isTrue(
      entries.some(
        (entry) =>
          entry.event === 'http.request.completed' &&
          entry.correlationId === authEvent.correlationId &&
          entry.status === 500
      )
    )
    assert.notInclude(lines.join('\n'), email)
    assert.notInclude(lines.join('\n'), password)
  })
})
