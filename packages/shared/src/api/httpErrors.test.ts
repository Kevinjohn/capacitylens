import { describe, expect, it } from 'vitest';
import { readHttpErrorBody } from './httpErrors.js';
import type { ProductHttpErrorBody } from './httpErrors.js';

describe('flat HTTP failure boundary', () => {
  it('retains committed and admission metadata without trusting malformed values', () => {
    const decision = { admitted: false, requirements: { invitation: { met: false } } };
    expect(
      readHttpErrorBody(
        { error: 'Waiting', code: 'E_ADMISSION_REQUIRED', decision, committed: true },
        'Fallback',
      ),
    ).toEqual({ error: 'Waiting', code: 'E_ADMISSION_REQUIRED', decision, committed: true });
    expect(
      readHttpErrorBody(
        { error: 1, code: 2, decision: [], committed: 'true', restorableItemCount: -1 },
        'Fallback',
      ),
    ).toEqual({ error: 'Fallback' });
  });
  it('narrows safe restoration counts and rejects fractional, infinite and string counts', () => {
    for (const count of [0, 3]) {
      expect(
        readHttpErrorBody({ restorableItemCount: count }, 'Fallback').restorableItemCount,
      ).toBe(count);
    }
    for (const count of [-1, 0.5, Infinity, '3', Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        readHttpErrorBody({ restorableItemCount: count }, 'Fallback').restorableItemCount,
      ).toBeUndefined();
    }
  });
  it('reads the first message of the framework validation answer', () => {
    expect(
      readHttpErrorBody(
        {
          errors: [
            { message: 'The email field must be defined', rule: 'required', field: 'email' },
          ],
        },
        'Fallback',
      ),
    ).toEqual({ error: 'The email field must be defined' });
    for (const errors of [[], [{ message: 1 }], [null], 'Invalid']) {
      expect(readHttpErrorBody({ errors }, 'Fallback')).toEqual({ error: 'Fallback' });
    }
  });
  it('handles absent and non-object bodies', () => {
    for (const value of [null, undefined, [], 'error']) {
      expect(readHttpErrorBody(value, 'Fallback')).toEqual({ error: 'Fallback' });
    }
  });
});

// These examples are checked by the shared test TypeScript project, alongside runtime tests.
function productTypeContracts() {
  const registered = {
    error: 'An account already uses this email.',
    code: 'E_EMAIL_IN_USE',
  } satisfies ProductHttpErrorBody;
  // @ts-expect-error An arbitrary dependency code cannot be assumed to be a known product code.
  const unsupported: ProductHttpErrorBody = { error: 'Unknown', code: 'FUTURE_DEPENDENCY_CODE' };
  // @ts-expect-error Restoration confirmation requires its operation metadata.
  const missingCount: ProductHttpErrorBody = {
    error: 'Confirm',
    code: 'E_RESTORATION_CONFIRMATION_REQUIRED',
  };
  const misplacedCount: ProductHttpErrorBody = {
    error: 'Nothing changed',
    code: 'E_NO_CHANGE',
    // @ts-expect-error An ordinary refusal has no restoration metadata.
    restorableItemCount: 2,
  };
  return [registered, unsupported, missingCount, misplacedCount];
}
void productTypeContracts;
