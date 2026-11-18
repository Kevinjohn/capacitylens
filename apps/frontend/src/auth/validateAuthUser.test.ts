import { describe, expect, it } from 'vitest';
import { parseAuthUser } from './validateAuthUser';

describe('validateAuthUser', () => {
  it('accepts a complete user and preserves forward-compatible fields', () => {
    const value = {
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      image: null,
      futureField: 'retained',
    };

    expect(parseAuthUser({ value })).toBe(value);
  });

  it.each([
    null,
    [],
    {},
    { id: '', email: 'user@example.test' },
    { id: 'user-1', name: 1, email: 'user@example.test' },
    { id: 'user-1', email: 1 },
    { id: 'user-1', image: 1, email: 'user@example.test' },
  ])('rejects a malformed auth response: %j', (value) => {
    expect(parseAuthUser({ value })).toBeNull();
  });

  it('requires a non-blank email', () => {
    expect(parseAuthUser({ value: { id: 'user-1' } })).toBeNull();
    expect(parseAuthUser({ value: { id: 'user-1', email: '   ' } })).toBeNull();
  });
});
