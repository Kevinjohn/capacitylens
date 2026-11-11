import { NULLABLE_FIELDS } from '../types/nullableFields.js';
import { describe, it, expect } from 'vitest';
import { seed } from './seed.js';
import {
  buildInternalClient,
  wouldAddSecondBuiltin,
  INTERNAL_CLIENT_NAME,
} from './internalClient.js';
import type { Client } from '../types/entities.js';

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

function registerPublicPredicateTests(): void {
  it('buildInternalClient uses the deterministic id and reserved name/colour with builtin:true', () => {
    const c = buildInternalClient('a9', TS);
    expect(c).toMatchObject({ accountId: 'a9', name: INTERNAL_CLIENT_NAME, builtin: true });
    expect(c.id).toBe('internal:a9');
  });

  // The shared predicate flags a proposed second built-in for the same account.
  it('wouldAddSecondBuiltin matches the client-side duplicate built-in write predicate', () => {
    const existing: Client = {
      ...NULLABLE_FIELDS.clients,
      id: 'c-int',
      accountId: 'a1',
      createdAt: TS,
      updatedAt: TS,
      name: 'Internal',
      color: '#9c3ace',
      builtin: true,
    };
    const clients = [existing];
    expect(wouldAddSecondBuiltin([], 'a1', 'c-int')).toBe(false);
    expect(wouldAddSecondBuiltin(clients, 'a1', 'c-int2')).toBe(true);
    expect(wouldAddSecondBuiltin(clients, 'a1', 'c-int')).toBe(false);
    expect(wouldAddSecondBuiltin(clients, 'a2', 'c-int-2')).toBe(false);
  });
}

describe('built-in Internal client', () => {
  registerSeedTests();
  registerPublicPredicateTests();
});
