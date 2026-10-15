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
