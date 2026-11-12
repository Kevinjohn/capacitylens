import { describe, it, expect } from 'vitest';
import { seed } from './seed.js';
import { buildInternalClient, INTERNAL_CLIENT_NAME } from './internalClient.js';

const TS = '2026-01-01T00:00:00.000Z';

function registerSeedTests(): void {
  it('seed gives every account exactly one builtin Internal client', () => {
    const data = seed();
    for (const account of data.accounts) {
      const internal = data.clients.filter((c) => c.builtin === true && c.accountId === account.id);
      expect(internal).toHaveLength(1);
      expect(internal[0]?.name).toBe(INTERNAL_CLIENT_NAME);
    }
  });
}

function registerCreationTests(): void {
  it('buildInternalClient uses the deterministic id and reserved name/colour with builtin:true', () => {
    const c = buildInternalClient('a9', TS);
    expect(c).toMatchObject({ accountId: 'a9', name: INTERNAL_CLIENT_NAME, builtin: true });
    expect(c.id).toBe('internal:a9');
  });
}

describe('built-in Internal client', () => {
  registerSeedTests();
  registerCreationTests();
});
