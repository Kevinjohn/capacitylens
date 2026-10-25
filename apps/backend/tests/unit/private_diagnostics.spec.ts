import { InvalidSessionError, UnverifiedEmailError } from 'adonisjs-account-kit/errors'
import { IdentityAuthorityError } from '#services/auth/authorization'
import { ActionProofError } from '#services/auth/action_proof'
import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import HttpExceptionHandler from '#exceptions/handler'
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

test('expected authentication and authorization refusals do not report server errors', async ({
  assert,
}) => {
  const handler = new HttpExceptionHandler()
  for (const [error, status] of [
    [new InvalidSessionError(), 401],
    [new UnverifiedEmailError(), 403],
    [new IdentityAuthorityError('PRIVATE_AUTHORITY'), 403],
    [new ActionProofError(), 403],
  ] as const) {
    const captured = diagnosticContext()
    await handler.handle(error, captured.context)
    await handler.report(error, captured.context)
    assert.equal(captured.status(), status)
    assert.deepEqual(captured.records, [])
  }
})
