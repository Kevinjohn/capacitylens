import { describe, expect, it } from 'vitest';
import type { DomainError } from './errors.js';
import type { Resource, Weekday } from '../types/entities.js';
import { resolveEffectiveWorkingWeek } from '../lib/effectiveWorkingWeek.js';
import { makeResource } from '../lib/capacity/capacity.test.support.js';
import { assertAllocationPlacement, reconcileReassignedHours } from './placement.js';
import type { ReconcileReassignedHoursInput } from './placement.js';

const resource = (overrides: Record<string, unknown> = {}) => ({
  kind: 'person' as const,
  workingDays: [1, 2, 3, 4, 5] as Weekday[],
  ...overrides,
});

const allocation = (overrides: Record<string, unknown> = {}) => ({
  resourceId: 'r1',
  startDate: '2026-06-15',
  endDate: '2026-06-16',
  ...overrides,
});

const changedPlacements = [
  {
    field: 'resource',
    next: allocation({ resourceId: 'r2' }),
    existing: allocation(),
    resource: resource({ firstAvailableDate: '2026-06-20' }),
    code: 'allocation_before_resource_availability',
  },
  {
    field: 'start date',
    next: allocation({ startDate: '2026-06-17', endDate: '2026-06-18' }),
    existing: allocation(),
    resource: resource({ lastAvailableDate: '2026-06-16' }),
    code: 'allocation_after_resource_availability',
  },
  {
    field: 'end date',
    next: allocation({ endDate: '2026-06-17' }),
    existing: allocation(),
    resource: resource({ lastAvailableDate: '2026-06-16' }),
    code: 'allocation_after_resource_availability',
  },
  {
    field: 'weekend policy',
    next: allocation({ startDate: '2026-06-13', endDate: '2026-06-14', ignoreWorkingDays: true }),
    existing: allocation({ startDate: '2026-06-13', endDate: '2026-06-14' }),
    resource: resource({ firstAvailableDate: '2026-06-15' }),
    code: 'allocation_before_resource_availability',
  },
] as const;

describe('assertAllocationPlacement', () => {
  it("skips availability checks when an existing allocation's placement is unchanged", () => {
    expect(() =>
      assertAllocationPlacement({
        allocation: allocation(),
        existing: allocation(),
        resource: resource({ firstAvailableDate: '2026-06-20' }),
        companyWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).not.toThrow();
  });

  it('checks availability for a new placement and preserves the domain error', () => {
    expect(() =>
      assertAllocationPlacement({
        allocation: allocation(),
        resource: resource({ firstAvailableDate: '2026-06-20' }),
        companyWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'allocation_before_resource_availability',
      }),
    );
  });
});

describe('changed allocation placement', () => {
  it.each(changedPlacements)(
    'checks availability when the $field field changes',
    ({ next, existing, resource: subject, code }) => {
      expect(() =>
        assertAllocationPlacement({
          allocation: next,
          existing,
          resource: subject,
          companyWorkingDays: [1, 2, 3, 4, 5],
        }),
      ).toThrowError(
        expect.objectContaining<Partial<DomainError>>({
          code: code as DomainError['code'],
        }),
      );
    },
  );
});

describe('reconcileReassignedHours', () => {
  const res = (kind: Resource['kind'], workingHoursPerDay = 8): Resource =>
    makeResource({ kind, workingHoursPerDay });
  const reconcile = (input: Omit<ReconcileReassignedHoursInput, 'effectiveWeek'>) =>
    reconcileReassignedHours({
      ...input,
      effectiveWeek: resolveEffectiveWorkingWeek(input.target, [1, 2, 3, 4, 5]),
    });
  it('forces 0 hours when reassigning onto an external (a capacity-free row carries no load)', () => {
    expect(
      reconcile({
        current: 8,
        target: res('external'),
        zeroLoadMode: false,
        startDate: '2026-06-01',
      }),
    ).toBe(0);
    expect(
      reconcile({
        current: 8,
        target: res('external'),
        zeroLoadMode: true,
        startDate: '2026-06-01',
      }),
    ).toBe(0);
  });
  it('keeps a real resource positive hours on a real-to-real reassign', () => {
    expect(
      reconcile({
        current: 6,
        target: res('person'),
        zeroLoadMode: false,
        startDate: '2026-06-01',
      }),
    ).toBe(6);
  });
  it('promotes a 0-hour booking (dragged off an external) to the target working day', () => {
    expect(
      reconcile({
        current: 0,
        target: res('person', 7),
        zeroLoadMode: false,
        startDate: '2026-06-01',
      }),
    ).toBe(8);
  });
  it('promotes a 0-hour booking to four hours on a target half day', () => {
    expect(
      reconcile({
        current: 0,
        target: { ...res('person', 7), halfDays: [2] },
        zeroLoadMode: false,
        startDate: '2026-06-02',
      }),
    ).toBe(4);
  });
  it('keeps a zero-hour block at zero when reassigning it off an external', () => {
    expect(
      reconcile({
        current: 0,
        target: res('person', 7),
        zeroLoadMode: true,
        startDate: '2026-06-01',
      }),
    ).toBe(0);
  });
});
