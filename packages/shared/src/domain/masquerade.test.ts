import { describe, expect, it } from 'vitest';
import { MASQUERADE_END_REASONS, MASQUERADE_ERROR_CODES } from './masquerade.js';

describe('masquerade contracts', () => {
  it('keeps the public end reasons and error codes stable', () => {
    expect(MASQUERADE_END_REASONS).toEqual([
      'explicit',
      'company_switch',
      'sign_out',
      'session_expired',
      'session_revoked',
      'caller_invalidated',
      'target_invalidated',
    ]);
    expect(MASQUERADE_ERROR_CODES).toEqual({
      active: 'E_MASQUERADE_ACTIVE',
      readOnly: 'E_MASQUERADE_READ_ONLY',
      ended: 'E_MASQUERADE_ENDED',
      contextRequired: 'E_MASQUERADE_CONTEXT_REQUIRED',
      contextChanged: 'E_MASQUERADE_CONTEXT_CHANGED',
    });
  });
});
