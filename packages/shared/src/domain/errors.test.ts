import { describe, expect, it } from 'vitest';
import { DomainError, throwDomainError } from './errors.js';

describe('throwDomainError', () => {
  it('throws a DomainError carrying the code and message', () => {
    expect(() => throwDomainError('date_invalid', 'That date is invalid.')).toThrow(DomainError);
    try {
      throwDomainError('date_invalid', 'That date is invalid.');
      expect.unreachable();
      // Verify the surfaced domain failure retains its stable code and error type.
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).name).toBe('DomainError');
      expect((err as DomainError).code).toBe('date_invalid');
      expect((err as DomainError).message).toBe('That date is invalid.');
    }
  });
});
