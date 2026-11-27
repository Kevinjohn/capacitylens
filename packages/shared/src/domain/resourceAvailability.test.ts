import { describe, expect, it } from 'vitest';
import type { DomainError } from './errors.js';
import type { Weekday } from '../types/entities.js';
import {
  assertAllocationWithinResourceAvailability,
  validateResourceAvailabilityPair,
} from './resourceAvailability.js';

const person = (overrides: Record<string, unknown> = {}) => ({
  kind: 'person' as const,
  workingDays: [1, 2, 3, 4, 5] as Weekday[],
  ...overrides,
});

describe('resource availability boundaries', () => {
  it('allows optional unbounded and equal inclusive boundaries', () => {
    expect(validateResourceAvailabilityPair()).toEqual({ ok: true, errors: [], codes: [] });
    expect(validateResourceAvailabilityPair('2026-06-15', '2026-06-15')).toEqual({
      ok: true,
      errors: [],
      codes: [],
    });
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: '2026-06-15', endDate: '2026-06-15' },
        resource: person({ firstAvailableDate: '2026-06-15', lastAvailableDate: '2026-06-15' }),
        companyWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).not.toThrow();
  });

  it('checks only scheduled weekdays unless ignoreWorkingDays is enabled', () => {
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: '2026-06-13', endDate: '2026-06-14' },
        resource: person({ firstAvailableDate: '2026-06-15' }),
        companyWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).not.toThrow();
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: '2026-06-13', endDate: '2026-06-14', ignoreWorkingDays: true },
        resource: person({ firstAvailableDate: '2026-06-15' }),
        companyWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'E_ALLOCATION_BEFORE_RESOURCE_AVAILABILITY',
      }),
    );
  });

  it('uses direction-specific errors, ignores non-people, and rejects reverse pairs', () => {
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: '2026-06-15', endDate: '2026-06-16' },
        resource: person({ lastAvailableDate: '2026-06-12' }),
        companyWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'E_ALLOCATION_AFTER_RESOURCE_AVAILABILITY',
      }),
    );
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: '2026-06-15', endDate: '2026-06-16' },
        resource: person({ kind: 'placeholder', firstAvailableDate: '2026-01-01' }),
        companyWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).not.toThrow();
    expect(validateResourceAvailabilityPair('2026-06-16', '2026-06-15')).toMatchObject({
      ok: false,
      codes: ['E_DATE_REVERSED'],
    });
    expect(validateResourceAvailabilityPair('2026-02-30')).toMatchObject({
      ok: false,
      codes: ['E_DATE_INVALID'],
    });
  });

  it('checks availability only on the company/person effective working-day intersection', () => {
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: '2026-06-15', endDate: '2026-06-15' },
        resource: person({ firstAvailableDate: '2026-06-16' }),
        companyWorkingDays: [2, 3, 4, 5, 6],
      }),
    ).not.toThrow();
  });
});
