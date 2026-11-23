import { test } from '@japa/runner';
import {
  E_DUPLICATE_REQUEST_CONFLICT,
  E_INVALID_COMMAND_VALUE,
} from '@kevinjohn/adonisjs-duplicate-request-guard';
import { mapAccountOperationError } from '#services/account_operations';
import { mapHttpError } from '#exceptions/http_error_mapping';

test('package refusals for an account operation retain the exact HTTP status and body', ({
  assert,
}) => {
  for (const [error, status, body] of [
    [
      new E_INVALID_COMMAND_VALUE(),
      400,
      { error: 'Invalid operation payload.', code: 'VALIDATION_ERROR' },
    ],
    [
      new E_DUPLICATE_REQUEST_CONFLICT(),
      409,
      { error: 'Operation id already used.', code: 'IDEMPOTENCY_CONFLICT' },
    ],
  ] as const) {
    assert.deepEqual(mapHttpError(mapAccountOperationError(error)), { status, body });
  }
  const unexpected = new Error('Database unavailable.');
  assert.strictEqual(mapAccountOperationError(unexpected), unexpected);
});
