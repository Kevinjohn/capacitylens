import { test } from '@japa/runner'
import { resetAuthenticatedClient } from '../helpers/authenticated_data_fixture.js'
import { LoggerFactory } from '@adonisjs/logger/factories'
import { freshDatabase } from '../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import Account from '#models/account'
import logger from '@adonisjs/core/services/logger'
import { seed } from '@capacitylens/shared/data/seed'
import env from '#start/env'
import loggerConfig from '#config/logger'

const privateError = 'SENTINEL_PRIVATE_EXCEPTION_VALUE'

async function captureLogs<T>(
  work: () => Promise<T>,
  interceptChild?: (child: ReturnType<typeof logger.child>) => void
): Promise<{ output: string; result: T }> {
  const lines: string[] = []
  const capture = new LoggerFactory()
    .merge({ ...loggerConfig.loggers.app, level: 'trace' })
    .pushLogsTo(lines)
    .create()
  const instrument = (child: ReturnType<typeof capture.child>) => {
    interceptChild?.(child)
    const originalChild = child.child
    child.child = ((...args: Parameters<typeof child.child>) =>
      instrument(originalChild.apply(child, args))) as typeof child.child
    return child
  }
  const originalChild = logger.child
  logger.child = ((...args: Parameters<typeof logger.child>) =>
    instrument(capture.child(...args))) as typeof logger.child
  try {
    const result = await work()
    return { output: lines.join('\n'), result }
  } finally {
    logger.child = originalChild
  }
}

const originalLoggingSetting = env.get('CAPACITYLENS_LOG')

test.group('general HTTP logging privacy', (group) => {
  group.setup(() => freshDatabase())
  group.setup(() => env.set('CAPACITYLENS_LOG', '1'))
  group.teardown(() => {
    env.set('CAPACITYLENS_LOG', originalLoggingSetting ?? '')
    if (originalLoggingSetting === undefined) delete process.env.CAPACITYLENS_LOG
  })

  test('redacts structured request/response containers and private error properties', async ({
    assert,
  }) => {
    const lines: string[] = []
    const capture = new LoggerFactory()
      .merge({ ...loggerConfig.loggers.app, level: 'trace' })
      .pushLogsTo(lines)
      .create()
    const cause = new Error('SENTINEL_CAUSE_MESSAGE')
    const error = Object.assign(new Error('SENTINEL_ERROR_MESSAGE'), {
      cause,
      privateDiagnostic: 'SENTINEL_ERROR_CUSTOM_VALUE',
    })
    capture.warn(
      {
        event: 'test.logger.redaction',
        method: 'POST',
        path: '/api/safe-pattern',
        req: {
          headers: {
            authorization: 'Bearer SENTINEL_REQ_AUTHORIZATION',
            cookie: 'session=SENTINEL_REQ_COOKIE',
          },
          body: { payload: 'SENTINEL_REQ_BODY' },
        },
        res: {
          headers: { 'set-cookie': 'session=SENTINEL_RES_COOKIE' },
          body: { payload: 'SENTINEL_RES_BODY' },
        },
        request: {
          headers: { authorization: 'Bearer SENTINEL_REQUEST_AUTHORIZATION' },
          body: { payload: 'SENTINEL_REQUEST_BODY' },
        },
        response: {
          headers: { 'set-cookie': 'session=SENTINEL_RESPONSE_COOKIE' },
          body: { payload: 'SENTINEL_RESPONSE_BODY' },
        },
        err: error,
      },
      'Structured logging privacy test'
    )

    const output = lines.join('\n')
    for (const secret of [
      'SENTINEL_REQ_AUTHORIZATION',
      'SENTINEL_REQ_COOKIE',
      'SENTINEL_REQ_BODY',
      'SENTINEL_RES_COOKIE',
      'SENTINEL_RES_BODY',
      'SENTINEL_REQUEST_AUTHORIZATION',
      'SENTINEL_REQUEST_BODY',
      'SENTINEL_RESPONSE_COOKIE',
      'SENTINEL_RESPONSE_BODY',
      'SENTINEL_ERROR_MESSAGE',
      'SENTINEL_CAUSE_MESSAGE',
      'SENTINEL_ERROR_CUSTOM_VALUE',
    ]) {
      assert.notInclude(output, secret)
    }
    assert.include(output, '"event":"test.logger.redaction"')
    assert.include(output, '"path":"/api/safe-pattern"')
    assert.include(output, '"err":{"category":"unexpected"}')
  })

  test('keeps completion logging disabled by default and for other values', async ({
    client,
    assert,
  }) => {
    for (const setting of ['', '0']) {
      env.set('CAPACITYLENS_LOG', setting)
      try {
        const { output, result } = await captureLogs(() => client.get('/api/health').send())
        assert.equal(result.status(), 200)
        assert.equal(output, '')
      } finally {
        env.set('CAPACITYLENS_LOG', '1')
      }
    }
  })

  test('keeps unexpected error diagnostics when routine request logging is disabled', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, true)
    const secret = 'SENTINEL_DISABLED_LOG_PRIVATE_EXCEPTION'
    const originalQuery = Account.query
    env.set('CAPACITYLENS_LOG', '0')
    Account.query = (() => {
      throw new Error(secret)
    }) as typeof Account.query
    try {
      const { output, result } = await captureLogs(() => client.get('/api/state').send())
      assert.equal(result.status(), 500)
      assert.include(output, '"event":"http.request.error"')
      assert.include(output, '"errorType":"unexpected"')
      assert.include(output, '"method":"GET"')
      assert.include(output, '"path":"/api/state"')
      assert.include(output, '"status":500')
      assert.notInclude(output, 'http.request.completed')
      assert.notInclude(output, secret)
    } finally {
      Account.query = originalQuery
      env.set('CAPACITYLENS_LOG', '1')
    }
  })

  test('preserves committed writes and emits a safe signal if completion logging fails', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, false)
    const accountId = 'a-logging-failure'
    const secret = 'SENTINEL_COMPLETION_LOG_FAILURE'
    const { output, result } = await captureLogs(
      () =>
        client
          .post('/api/orgs')
          .header('sec-fetch-site', 'same-origin')
          .json({ ...seed().accounts[0]!, id: accountId })
          .send(),
      (child) => {
        const originalLog = child.log
        child.log = ((...args: Parameters<typeof child.log>) => {
          if (args[0] === 'info') throw new Error(secret)
          return originalLog.apply(child, args)
        }) as typeof child.log
      }
    )
    const committed = await db.from('accounts').where('id', accountId).first()

    assert.isDefined(committed)
    assert.equal(result.status(), 201)
    assert.include(output, '"event":"http.request.logging_failed"')
    assert.notInclude(output, secret)
  })

  test('writes bounded completion diagnostics without secrets from unmatched encoded paths or headers', async ({
    client,
    assert,
  }) => {
    const auth = 'SENTINEL_BEARER_AUTHORIZATION'
    const cookie = 'SENTINEL_SESSION_COOKIE'
    const query = 'SENTINEL_QUERY_SECRET'
    const token = 'SENTINEL/ENCODED_INVITE_PATH_TOKEN'
    const { output, result } = await captureLogs(() =>
      client
        .get(`/api/%2569nvites%252f${encodeURIComponent(token)}/preview?state=${query}`)
        .header('authorization', `Bearer ${auth}`)
        .header('cookie', `session=${cookie}`)
        .send()
    )

    assert.equal(result.status(), 401)
    assert.include(output, 'GET')
    assert.include(output, '"path":"/*"')
    assert.include(output, '401')
    assert.notInclude(output, auth)
    assert.notInclude(output, cookie)
    assert.notInclude(output, query)
    assert.notInclude(output, token)
  })

  test('replaces oversized incoming request ids in logs with a bounded server correlation id', async ({
    client,
    assert,
  }) => {
    const requestId = `SENTINEL_${'UNTRUSTED'.repeat(512)}`
    const { output, result } = await captureLogs(async () => {
      const responses = await Promise.all(
        Array.from({ length: 3 }, () =>
          client.get('/api/health').header('x-request-id', requestId).send()
        )
      )
      return responses[2]!
    })

    assert.equal(result.status(), 200)
    assert.notInclude(output, requestId)
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const correlationIds = records.map((record) => String(record['correlationId']))
    assert.lengthOf(correlationIds, 3)
    assert.lengthOf(new Set(correlationIds), 3)
    assert.isTrue(correlationIds.every((correlationId) => correlationId.length <= 32))
  })

  test('logs malformed body-parser requests without including their body', async ({
    client,
    assert,
  }) => {
    const secret = 'SENTINEL_MALFORMED_REQUEST_BODY'
    const { output, result } = await captureLogs(() =>
      client.post('/api/batch').unsafeJson(`{"secret":"${secret}"`).send()
    )

    assert.equal(result.status(), 400)
    assert.include(output, 'POST')
    assert.include(output, '"path":"/api/batch"')
    assert.include(output, '400')
    assert.notInclude(output, secret)
  })

  test('rejects transfer parser input without logging private messages or stacks', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, true)
    const secret = 'SENTINEL_IMPORT_PARSER_VALUE'
    const { output, result } = await captureLogs(() =>
      client
        .post('/api/transfer/apply')
        .header('sec-fetch-site', 'same-origin')
        .json({ accountId: 'a-studio', document: { secret }, baseRevision: 0 })
        .send()
    )

    assert.equal(result.status(), 400)
    assert.include(output, '/api/transfer/apply')
    assert.notInclude(output, secret)
    assert.notInclude(output, 'stack')
  })

  test('reports unexpected errors with useful classification and no private exception data', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, true)
    const originalQuery = Account.query
    Account.query = (() => {
      throw new Error(privateError)
    }) as typeof Account.query
    try {
      const captured = await captureLogs(() => client.get('/api/state').send())
      assert.notInclude(captured.output, privateError)
      assert.equal(captured.result.status(), 500)
      assert.deepEqual(captured.result.body(), { error: 'Internal server error.' })
      assert.include(captured.output, 'GET')
      assert.include(captured.output, '/api/state')
      assert.include(captured.output, '500')
    } finally {
      Account.query = originalQuery
    }
  })
})
