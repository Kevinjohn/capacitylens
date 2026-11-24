import { test } from '@japa/runner';
import {
  E_DUPLICATE_REQUEST_CONFLICT,
  E_INVALID_COMMAND_VALUE,
} from '@kevinjohn/adonisjs-duplicate-request-guard';
import { mapAccountOperationError } from '#services/account_operations';
import { ProductException } from '#exceptions/product_exception';

test('package refusals for an account operation retain the exact HTTP status and body', ({
  assert,
}) => {
  for (const [error, status, body] of [
    [new E_INVALID_COMMAND_VALUE(), 422, { errors: [{ message: 'Invalid operation payload.' }] }],
    [
      new E_DUPLICATE_REQUEST_CONFLICT(),
      409,
      { error: 'Operation id already used.', code: 'IDEMPOTENCY_CONFLICT' },
    ],
  ] as const) {
    const mapped = mapAccountOperationError(error);
    assert.instanceOf(mapped, ProductException);
    const refusal = mapped as ProductException;
    assert.deepEqual({ status: refusal.status, body: refusal.body() }, { status, body });
  }
  const unexpected = new Error('Database unavailable.');
  assert.strictEqual(mapAccountOperationError(unexpected), unexpected);
});
