import app from '@adonisjs/core/services/app'
import {
  E_ACCOUNT_KIT_INVALID_SESSION,
  E_ACCOUNT_KIT_UNVERIFIED_EMAIL,
} from '@kevinjohn/adonisjs-account-kit/errors'
import { errors as accessControlErrors } from '@kevinjohn/adonisjs-access-control'
import IdentityAuthorizationException from '#exceptions/identity_authorization_exception'
import PasswordConfirmationException from '#exceptions/password_confirmation_exception'
import { test } from '@japa/runner'
import { PasswordConfirmationRequiredException } from '@kevinjohn/adonisjs-confirm-action-with-password'
import type { HttpContext } from '@adonisjs/core/http'
import HttpExceptionHandler from '#exceptions/handler'
import AccountDeletionCommittedException from '#exceptions/account_deletion_committed_exception'
import CredentialUpdateCommittedException from '#exceptions/credential_update_committed_exception'
import DiagnosticsUnavailableException from '#exceptions/diagnostics_unavailable_exception'
import VerificationCommittedException from '#exceptions/verification_committed_exception'
import VerificationDeliveryFailedException from '#exceptions/verification_delivery_failed_exception'
test.group('private diagnostics', () => {
  test('error reporting survives a failed diagnostic logger', async ({ assert }) => {
    const ctx = {
      request: { method: () => 'GET', id: () => undefined },
      route: { pattern: '/api/v1/state' },
      logger: {
        log() {
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
      request: { method: () => 'POST', id: () => undefined },
      route: { pattern: '/api/v1/auth/sign-in' },
      logger: {
        log: (...args: unknown[]) => {
          records.push(args)
        },
      },
      response: {
        header: () => undefined,
        badRequest: () => send(400),
        forbidden: () => send(403),
        internalServerError: () => send(500),
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
      [new E_ACCOUNT_KIT_INVALID_SESSION(), 401],
      [new E_ACCOUNT_KIT_UNVERIFIED_EMAIL(), 403],
      [new IdentityAuthorizationException('PRIVATE_AUTHORIZATION'), 403],
      [new PasswordConfirmationException(), 403],
      [new PasswordConfirmationRequiredException(), 403],
    ] as const) {
      const captured = diagnosticContext()
      await handler.handle(error, captured.context)
      await handler.report(error, captured.context)
      assert.equal(captured.status(), status)
      assert.deepEqual(captured.records, [])
    }
  })

  test('expected 503 outcomes answer without a report', async ({ assert }) => {
    const handler = new HttpExceptionHandler()
    for (const error of [
      new AccountDeletionCommittedException(),
      new CredentialUpdateCommittedException(),
      new DiagnosticsUnavailableException(),
      new VerificationCommittedException(),
      new VerificationDeliveryFailedException(),
    ]) {
      const captured = diagnosticContext()
      await handler.handle(error, captured.context)
      await handler.report(error, captured.context)
      assert.equal(captured.status(), 503, error.name)
      assert.deepEqual(captured.records, [], error.name)
    }
  })

  test('an Access Control refusal answers without a report; its invalid-input fault is a reported 500', async ({
    assert,
  }) => {
    const handler = new HttpExceptionHandler()
    const refused = diagnosticContext()
    const refusal = new accessControlErrors.E_ACCESS_CONTROL_FORBIDDEN()
    await handler.handle(refusal, refused.context)
    await handler.report(refusal, refused.context)
    assert.equal(refused.status(), 403)
    assert.deepEqual(refused.records, [])

    const faulted = diagnosticContext()
    const fault = new accessControlErrors.E_ACCESS_CONTROL_INVALID_INPUT(
      'access-control: acceptInvitation requires a transaction'
    )
    await handler.handle(fault, faulted.context)
    await handler.report(fault, faulted.context)
    assert.equal(faulted.status(), 500)
    assert.lengthOf(faulted.records, 1)
    assert.notInclude(JSON.stringify(faulted.records), 'requires a transaction')
  })

  for (const environment of ['development', 'test', 'production'] as const) {
    test(`unexpected failures expose details outside production: ${environment}`, async ({
      assert,
    }) => {
      const descriptor = Object.getOwnPropertyDescriptor(app, 'inProduction')
      Object.defineProperty(app, 'inProduction', {
        configurable: true,
        value: environment === 'production',
      })
      const failure = new Error('PRIVATE_UNEXPECTED_MESSAGE')
      let body: unknown
      const ctx = {
        response: {
          internalServerError(value: unknown) {
            body = value
          },
          status: () => ({
            send(value: unknown) {
              body = value
            },
          }),
        },
      } as unknown as HttpContext
      try {
        await new HttpExceptionHandler().handle(failure, ctx)
        assert.deepEqual(
          body,
          environment === 'production'
            ? { error: 'Internal server error.', code: 'E_INTERNAL_SERVER_ERROR' }
            : { error: failure.message, stack: failure.stack }
        )
      } finally {
        if (descriptor) Object.defineProperty(app, 'inProduction', descriptor)
        else Reflect.deleteProperty(app, 'inProduction')
      }
    })
  }
})
