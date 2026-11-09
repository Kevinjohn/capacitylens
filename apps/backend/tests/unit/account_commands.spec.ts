import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import {
  E_DUPLICATE_REQUEST_CONFLICT,
  E_INVALID_COMMAND_VALUE,
} from '@kevinjohn/adonisjs-duplicate-request-guard';
import { toAccountCommandError } from '#services/account_commands';
import { renderAdmissionFailure } from '#services/admission/http';

test('package command refusals retain the exact HTTP status and body', ({ assert }) => {
  for (const [error, status, body] of [
    [
      new E_INVALID_COMMAND_VALUE(),
      400,
      { error: 'Invalid command payload.', code: 'VALIDATION_FAILED' },
    ],
    [
      new E_DUPLICATE_REQUEST_CONFLICT(),
      409,
      { error: 'Command identity already used.', code: 'IDEMPOTENCY_CONFLICT' },
    ],
  ] as const) {
    const ctx = {
      response: {
        status: (actualStatus: number) => ({
          send: (actualBody: unknown) => ({ status: actualStatus, body: actualBody }),
        }),
      },
    } as unknown as HttpContext;
    assert.deepEqual(renderAdmissionFailure(ctx, toAccountCommandError(error)), { status, body });
  }
  const unexpected = new Error('Database unavailable.');
  assert.strictEqual(toAccountCommandError(unexpected), unexpected);
});
