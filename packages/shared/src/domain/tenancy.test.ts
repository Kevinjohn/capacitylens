import { describe, expect, it } from 'vitest';
import type { ScopedEntity } from '../types/entities.js';
import { belongsToCompany, byAccount } from './tenancy.js';

const rows = [
  { id: 'a-row', companyId: 'a' },
  { id: 'b-row', companyId: 'b' },
  { id: 'a-row-2', companyId: 'a' },
] as ScopedEntity[];

describe('tenant predicates', () => {
  it('compares the exact account id', () => {
    const row = rows[0];
    if (row === undefined) throw new Error('Fixture must include an account-a row.');
    expect(belongsToCompany(row, 'a')).toBe(true);
    expect(belongsToCompany(row, 'A')).toBe(false);
    expect(belongsToCompany(row, 'b')).toBe(false);
  });

  it('partitions a mixed table exactly without changing row identity', () => {
    const owned = rows.filter(byAccount('a'));
    const remaining = rows.filter((scopedEntity) => !belongsToCompany(scopedEntity, 'a'));

    expect(owned).toEqual([rows[0], rows[2]]);
    expect(remaining).toEqual([rows[1]]);
    expect([...owned, ...remaining]).toHaveLength(rows.length);
    expect(new Set([...owned, ...remaining])).toEqual(new Set(rows));
  });
});
