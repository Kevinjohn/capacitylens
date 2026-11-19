import { describe, it, expect, afterEach, vi } from 'vitest';
import { createId } from './id.js';

describe('createId', () => {
  it('delegates every id to the platform CSPRNG instead of synthesising a counter', () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    vi.stubGlobal('crypto', { randomUUID });
    try {
      expect([createId(), createId()]).toEqual([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ]);
      expect(randomUUID).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns a v4-style uuid string', () => {
    expect(createId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('returns unique values', () => {
    expect(createId()).not.toBe(createId());
  });

  describe('when crypto.randomUUID is unavailable', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('throws the documented createId() message when crypto itself is absent', () => {
      vi.stubGlobal('crypto', undefined);
      // A mutant that guts the guard (e.g. `if (false)`, or short-circuits the `||`
      // so the second half never runs) skips the throw and instead lets
      // `crypto.randomUUID()` blow up with an unrelated native TypeError, this
      // message match only survives on the real, intended guard.
      expect(() => createId()).toThrow(
        /^createId\(\): crypto\.randomUUID is unavailable\. CapacityLens needs a secure context/,
      );
    });

    it('throws the same documented message when crypto exists but has no randomUUID', () => {
      vi.stubGlobal('crypto', {});
      expect(() => createId()).toThrow(
        /^createId\(\): crypto\.randomUUID is unavailable\. CapacityLens needs a secure context/,
      );
    });
  });
});
