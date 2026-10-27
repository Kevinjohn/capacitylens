import { test } from '@japa/runner'
import { LoggerFactory } from '@adonisjs/logger/factories'
import logger from '@adonisjs/core/services/logger'
import loggerConfig from '#config/logger'
import env from '#start/env'
import { freshDatabase } from '../helpers/fresh_database.js'
import { createIdentity, clearIdentities } from '../helpers/identities.js'
import limiter from '@adonisjs/limiter/services/main'

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
    assert.include(lines.join('\n'), '"outcome":"throttled"')
    assert.notInclude(lines.join('\n'), 'private-throttle@example.test')
    assert.notInclude(lines.join('\n'), 'never-store-this-password')
  })
})
