import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import {
  PasswordConfirmationRequiredException,
  PasswordConfirmationStaleException,
  PasswordConfirmationForbiddenException,
  PasswordConfirmationDeniedException,
  PasswordConfirmationThrottledException,
  InvalidPasswordConfirmationRequestException,
  InvalidPasswordConfirmationsConfigException,
  SessionRegistryRequiredException,
} from '@kevinjohn/adonisjs-confirm-action-with-password';
import HttpExceptionHandler from '#exceptions/handler';

const required = { error: 'Confirm this action again.', code: 'PASSWORD_CONFIRMATION_REQUIRED' };
for (const [error, status, expected] of [
  [new PasswordConfirmationRequiredException(), 403, required],
  [new PasswordConfirmationStaleException(), 403, required],
  [new PasswordConfirmationForbiddenException(), 403, required],
  [
    new PasswordConfirmationDeniedException(),
    403,
    { error: 'Incorrect password.', code: 'PASSWORD_CONFIRMATION_DENIED' },
  ],
  [
    new PasswordConfirmationThrottledException(1200),
    429,
    { error: 'Too many attempts. Try again in 20 minutes.' },
  ],
  [
    new PasswordConfirmationThrottledException(0.4),
    429,
    { error: 'Too many attempts. Try again in 1 minute.' },
  ],
  [
    new InvalidPasswordConfirmationRequestException('PRIVATE_INPUT'),
    400,
    { error: 'Invalid password confirmation.' },
  ],
  [
    new InvalidPasswordConfirmationsConfigException('PRIVATE_CONFIG'),
    500,
    { error: 'Internal server error.' },
  ],
  [new SessionRegistryRequiredException(), 500, { error: 'Internal server error.' }],
] as const) {
  test(`proof error ${error.code} preserves its complete response and reporting classification`, async ({
    assert,
  }) => {
    let actualStatus: number | undefined;
    let body: unknown;
    const headers: Record<string, string> = {};
    const reports: unknown[] = [];
    const ctx = {
      request: { method: () => 'POST' },
      route: { pattern: '/api/auth/password-confirmation' },
      logger: { error: (fields: unknown) => reports.push(fields) },
      response: {
        header(name: string, value: string) {
          headers[name] = value;
        },
        status(code: number) {
          actualStatus = code;
          return {
            send: (value: unknown) => {
              body = value;
            },
          };
        },
        internalServerError(value: unknown) {
          actualStatus = 500;
          body = value;
        },
      },
    } as unknown as HttpContext;
    const handler = new HttpExceptionHandler();
    await handler.handle(error, ctx);
    await handler.report(error, ctx);
    assert.equal(actualStatus, status);
    assert.deepEqual(body, expected);
    const retryAfter =
      error instanceof PasswordConfirmationThrottledException
        ? { 'Retry-After': String(Math.max(1, Math.ceil(error.retryAfterSeconds))) }
        : {};
    assert.deepEqual(headers, retryAfter);
    assert.lengthOf(reports, status === 500 ? 1 : 0);
    if (status === 500)
      assert.deepEqual(reports[0], {
        event: 'http.request.error',
        errorType: 'unexpected',
        method: 'POST',
        path: '/api/auth/password-confirmation',
        status: 500,
      });
  });
}
