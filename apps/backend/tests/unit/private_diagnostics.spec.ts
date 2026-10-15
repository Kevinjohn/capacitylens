import { SessionAuthorityError } from '#services/auth/session_authority'
import { IdentityAuthorityError } from '#services/auth/authorization'
import { PasswordProcessingUnavailableError } from '#services/password_service'
import {
  PasswordPolicyError,
  PasswordScreeningUnavailableError,
} from '#services/password_screening'
import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import HttpExceptionHandler from '#exceptions/handler'
import GoogleController from '#controllers/google_controller'
import env from '#start/env'

test('a Google callback failure keeps its redirect and never logs private cause or error name', async ({
  assert,
}) => {
  const keys = [
    'CAPACITYLENS_MODE',
    'CAPACITYLENS_GOOGLE_CLIENT_ID',
    'CAPACITYLENS_GOOGLE_CLIENT_SECRET',
  ] as const
  const previous = keys.map((key) => ({ key, value: env.get(key), raw: process.env[key] }))
  env.set(keys[0], 'password-and-sso')
  env.set(keys[1], 'fixture-client')
  env.set(keys[2], 'fixture-secret')
  const lines: unknown[] = []
  let location = ''
  const privateError = Object.assign(new Error('PRIVATE_PROVIDER_TOKEN'), {
    name: 'PRIVATE_PROVIDER_NAME',
    cause: new Error('PRIVATE_CAUSE'),
  })
  const context = {
    session: {
      get: () => ({
        kind: 'sign-in',
        successPath: '/',
        errorPath: '/login',
        createdAt: Date.now(),
      }),
      forget() {},
    },
    ally: {
      use: () => ({
        stateMisMatch: () => false,
        hasError: () => false,
        async user() {
          throw privateError
        },
      }),
    },
    request: { input: () => 'fixture-state' },
    logger: {
      error: (...args: unknown[]) => {
        lines.push(args)
      },
    },
    response: {
      redirect: () => ({
        withQs: () => ({
          toPath: (path: string) => {
            location = path
          },
        }),
      }),
    },
  } as unknown as HttpContext
  try {
    await new GoogleController().callback(context)
    assert.include(location, 'provider_unavailable')
    assert.notInclude(JSON.stringify(lines), 'PRIVATE_')
    context.logger.error = () => {
      throw privateError
    }
    location = ''
    await new GoogleController().callback(context)
    assert.include(location, 'provider_unavailable')
  } finally {
    for (const { key, value, raw } of previous) {
      env.set(key, value ?? '')
      if (raw === undefined) delete process.env[key]
      else process.env[key] = raw
    }
  }
})

test('error reporting survives a failed diagnostic logger', async ({ assert }) => {
  const ctx = {
    request: { method: () => 'GET' },
    route: { pattern: '/api/state' },
    logger: {
      error() {
        throw new Error('PRIVATE_LOGGER_FAILURE')
      },
    },
  } as unknown as HttpContext
  await assert.doesNotReject(() =>
    new HttpExceptionHandler().report(new Error('PRIVATE_CAUSE'), ctx)
  )
})

function diagnosticContext() {
  let status = 200
  const records: unknown[][] = []
  const send = (value: number) => {
    status = value
  }
  const context = {
    request: { method: () => 'POST' },
    route: { pattern: '/api/auth/sign-in' },
    logger: {
      error: (...args: unknown[]) => {
        records.push(args)
      },
    },
    response: {
      badRequest: () => send(400),
      forbidden: () => send(403),
      serviceUnavailable: () => send(503),
      status(value: number) {
        return { send: () => send(value) }
      },
    },
  } as unknown as HttpContext
  return { context, records, status: () => status }
}

test('expected authentication, authorization and password policy refusals do not report server errors', async ({
  assert,
}) => {
  const handler = new HttpExceptionHandler()
  for (const [error, status] of [
    [new SessionAuthorityError('PRIVATE_SESSION'), 401],
    [new SessionAuthorityError('PRIVATE_FRESHNESS', 'SESSION_NOT_FRESH', 403), 403],
    [new IdentityAuthorityError('PRIVATE_AUTHORITY'), 403],
    [new PasswordPolicyError('PRIVATE_PASSWORD', 'PASSWORD_COMPROMISED'), 400],
  ] as const) {
    const captured = diagnosticContext()
    await handler.handle(error, captured.context)
    await handler.report(error, captured.context)
    assert.equal(captured.status(), status)
    assert.deepEqual(captured.records, [])
  }
})

test('password dependency failures report their actual 503 status with bounded private diagnostics', async ({
  assert,
}) => {
  const handler = new HttpExceptionHandler()
  for (const [error, category] of [
    [
      new PasswordProcessingUnavailableError(new Error('PRIVATE_PROCESSING_CAUSE')),
      'password_processing_unavailable',
    ],
    [
      new PasswordScreeningUnavailableError(new Error('PRIVATE_SCREENING_CAUSE')),
      'password_screening_unavailable',
    ],
  ] as const) {
    const captured = diagnosticContext()
    await handler.handle(error, captured.context)
    await handler.report(error, captured.context)
    assert.equal(captured.status(), 503)
    assert.deepEqual(captured.records, [
      [
        {
          event: 'http.request.error',
          errorType: category,
          method: 'POST',
          path: '/api/auth/sign-in',
          status: 503,
        },
        'HTTP request failed',
      ],
    ])
    assert.notInclude(JSON.stringify(captured.records), 'PRIVATE_')
    assert.notInclude(JSON.stringify(captured.records), '500')
  }
})
