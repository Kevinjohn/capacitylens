import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import {
  ActionProofRequiredException,
  ActionProofStaleException,
  ActionProofForbiddenException,
  ActionProofDeniedException,
  ActionProofThrottledException,
  InvalidActionProofRequestException,
  InvalidActionProofsConfigException,
  SessionRegistryRequiredException,
} from '@kevinjohn/adonisjs-action-proofs';
import HttpExceptionHandler from '#exceptions/handler';

const required = { error: 'Confirm this action again.', code: 'ACTION_PROOF_REQUIRED' };
for (const [error, status, expected] of [
  [new ActionProofRequiredException(), 403, required],
  [new ActionProofStaleException(), 403, required],
  [new ActionProofForbiddenException(), 403, required],
  [
    new ActionProofDeniedException(),
    403,
    { error: 'Incorrect password.', code: 'ACTION_PROOF_DENIED' },
  ],
  [new ActionProofThrottledException(1200), 429, { error: 'Rate limit exceeded.' }],
  [
    new InvalidActionProofRequestException('PRIVATE_INPUT'),
    400,
    { error: 'Invalid action confirmation.' },
  ],
  [
    new InvalidActionProofsConfigException('PRIVATE_CONFIG'),
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
    const reports: unknown[] = [];
    const ctx = {
      request: { method: () => 'POST' },
      route: { pattern: '/api/auth/action-proof/password' },
      logger: { error: (fields: unknown) => reports.push(fields) },
      response: {
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
    assert.lengthOf(reports, status === 500 ? 1 : 0);
    if (status === 500)
      assert.deepEqual(reports[0], {
        event: 'http.request.error',
        errorType: 'unexpected',
        method: 'POST',
        path: '/api/auth/action-proof/password',
        status: 500,
      });
  });
}
