import { describe, it, expect } from 'vitest';
import { seed } from './seed.js';
import { buildInternalClient, INTERNAL_CLIENT_NAME } from './internalClient.js';

const TS = '2026-01-01T00:00:00.000Z';

describe('built-in Internal client', () => {
  it('seed gives every company exactly one builtin Internal client', () => {
    const data = seed();
    for (const company of data.companies) {
      const internal = data.clients.filter((c) => c.builtin === true && c.companyId === company.id);
      expect(internal).toHaveLength(1);
      expect(internal[0]?.name).toBe(INTERNAL_CLIENT_NAME);
    }
  });
  it('buildInternalClient uses the deterministic id and reserved name/colour with builtin:true', () => {
    const c = buildInternalClient('a9', TS);
    expect(c).toMatchObject({ companyId: 'a9', name: INTERNAL_CLIENT_NAME, builtin: true });
    expect(c.id).toBe('internal:a9');
  });
});
