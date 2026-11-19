import { test } from '@japa/runner';
import {
  E_DUPLICATE_REQUEST_CONFLICT,
  E_INVALID_COMMAND_VALUE,
} from '@kevinjohn/adonisjs-duplicate-request-guard';
import { mapAccountCommandError } from '#services/account_commands';
import { mapHttpError } from '#exceptions/http_error_mapping';

test('package command refusals retain the exact HTTP status and body', ({ assert }) => {
  for (const [error, status, body] of [
    [
      new E_INVALID_COMMAND_VALUE(),
      400,
      { error: 'Invalid command payload.', code: 'VALIDATION_ERROR' },
    ],
    [
      new E_DUPLICATE_REQUEST_CONFLICT(),
      409,
      { error: 'Command identity already used.', code: 'IDEMPOTENCY_CONFLICT' },
    ],
  ] as const) {
    assert.deepEqual(mapHttpError(mapAccountCommandError(error), 'admission'), { status, body });
  }
  const unexpected = new Error('Database unavailable.');
  assert.strictEqual(mapAccountCommandError(unexpected), unexpected);
});
