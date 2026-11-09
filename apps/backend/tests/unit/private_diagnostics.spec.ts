import app from '@adonisjs/core/services/app';
import { InvalidSessionError, UnverifiedEmailError } from '@kevinjohn/adonisjs-account-kit/errors';
import { AccessControlError } from '@kevinjohn/adonisjs-access-control';
import { IdentityAuthorityError } from '#services/auth/authorization';
import { PasswordConfirmationError } from '#services/auth/password_confirmation';
import { test } from '@japa/runner';
import { PasswordConfirmationRequiredException } from '@kevinjohn/adonisjs-confirm-action-with-password';
import type { HttpContext } from '@adonisjs/core/http';
import HttpExceptionHandler from '#exceptions/handler';
test('error reporting survives a failed diagnostic logger', async ({ assert }) => {
  const ctx = {
    request: { method: () => 'GET' },
    route: { pattern: '/api/state' },
    logger: {
      error() {
        throw new Error('PRIVATE_LOGGER_FAILURE');
      },
    },
  } as unknown as HttpContext;
  await assert.doesNotReject(() =>
    new HttpExceptionHandler().report(new Error('PRIVATE_CAUSE'), ctx)
  );
});

function diagnosticContext() {
  let status = 200;
  const records: unknown[][] = [];
  const send = (value: number) => {
    status = value;
  };
  const context = {
    request: { method: () => 'POST' },
    route: { pattern: '/api/auth/sign-in' },
    logger: {
      error: (...args: unknown[]) => {
        records.push(args);
      },
    },
    response: {
      header: () => undefined,
      badRequest: () => send(400),
      forbidden: () => send(403),
      internalServerError: () => send(500),
      serviceUnavailable: () => send(503),
      status(value: number) {
        return { send: () => send(value) };
      },
    },
  } as unknown as HttpContext;
  return { context, records, status: () => status };
}

test('expected authentication and authorization refusals do not report server errors', async ({
  assert,
}) => {
  const handler = new HttpExceptionHandler();
  for (const [error, status] of [
    [new InvalidSessionError(), 401],
    [new UnverifiedEmailError(), 403],
    [new IdentityAuthorityError('PRIVATE_AUTHORITY'), 403],
    [new PasswordConfirmationError(), 403],
    [new PasswordConfirmationRequiredException(), 403],
  ] as const) {
    const captured = diagnosticContext();
    await handler.handle(error, captured.context);
    await handler.report(error, captured.context);
    assert.equal(captured.status(), status);
    assert.deepEqual(captured.records, []);
  }
});

test('an Access Control refusal answers without a report; its invalid-input fault is a reported 500', async ({
  assert,
}) => {
  const handler = new HttpExceptionHandler();
  const refused = diagnosticContext();
  const refusal = new AccessControlError('E_ACCESS_CONTROL_FORBIDDEN');
  await handler.handle(refusal, refused.context);
  await handler.report(refusal, refused.context);
  assert.equal(refused.status(), 403);
  assert.deepEqual(refused.records, []);

  const faulted = diagnosticContext();
  const fault = new AccessControlError('E_ACCESS_CONTROL_INVALID_INPUT', {
    message: 'access-control: acceptInvitation requires a transaction',
  });
  await handler.handle(fault, faulted.context);
  await handler.report(fault, faulted.context);
  assert.equal(faulted.status(), 500);
  assert.lengthOf(faulted.records, 1);
  assert.notInclude(JSON.stringify(faulted.records), 'requires a transaction');
});

for (const environment of ['development', 'test', 'production'] as const) {
  test(`unexpected failures expose details only in development: ${environment}`, async ({
    assert,
  }) => {
    const descriptor = Object.getOwnPropertyDescriptor(app, 'inDev');
    Object.defineProperty(app, 'inDev', {
      configurable: true,
      value: environment === 'development',
    });
    const failure = new Error('PRIVATE_UNEXPECTED_MESSAGE');
    let body: unknown;
    const ctx = {
      response: {
        internalServerError(value: unknown) {
          body = value;
        },
      },
    } as unknown as HttpContext;
    try {
      await new HttpExceptionHandler().handle(failure, ctx);
      assert.deepEqual(
        body,
        environment === 'development'
          ? { error: failure.message, stack: failure.stack }
          : { error: 'Internal server error.' }
      );
    } finally {
      if (descriptor) Object.defineProperty(app, 'inDev', descriptor);
      else Reflect.deleteProperty(app, 'inDev');
    }
  });
}
