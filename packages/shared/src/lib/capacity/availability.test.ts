import { describe, it, expect } from 'vitest';
import { isHalfDay, isOnClosure, isOnTimeOff } from '../capacity.js';

import {
  scheduledHoursOnDay,
  availableHoursOnDay,
  allocatedHoursOnDay,
  isWorkingDay,
  makeResource,
  makeAlloc,
  makeTimeOff,
  makeClosure,
} from './capacity.test.support.js';

describe('resource availability boundaries', () => {
  const boundedResource = makeResource({
    firstAvailableDate: '2026-09-08',
    lastAvailableDate: '2026-09-10',
  });

  it.each([
    ['2026-09-07', 0],
    ['2026-09-08', 8],
    ['2026-09-10', 8],
    ['2026-09-11', 0],
  ] as const)('returns boundary-aware capacity on %s', (date, expected) => {
    expect(availableHoursOnDay({ resource: boundedResource, date, timeOff: [] })).toBe(expected);
  });

  it('does not apply person-only boundaries to a non-person row', () => {
    const placeholder = makeResource({
      kind: 'placeholder',
      firstAvailableDate: '2026-09-08',
      lastAvailableDate: '2026-09-10',
    });

    expect(availableHoursOnDay({ resource: placeholder, date: '2026-09-07', timeOff: [] })).toBe(8);
  });
});

describe('availability', () => {
  const r = makeResource();
  it('ignores stored placeholder half days while retaining personal half days', () => {
    const person = makeResource({ halfDays: [2] });
    const placeholder = makeResource({ kind: 'placeholder', halfDays: [2] });

    expect(isHalfDay(person, 2)).toBe(true);
    expect(isHalfDay(placeholder, 2)).toBe(false);
    expect(scheduledHoursOnDay(placeholder, '2026-06-02')).toBe(8);
  });

  it('knows working vs non-working weekdays', () => {
    expect(isWorkingDay(r, '2026-06-01')).toBe(true);
    expect(isWorkingDay(r, '2026-06-06')).toBe(false);
    expect(isWorkingDay(r, '2026-06-07')).toBe(false);
  });

  it('detects time off ranges', () => {
    const timeOff = [makeTimeOff({ startDate: '2026-06-03', endDate: '2026-06-04' })];
    expect(isOnTimeOff('r1', '2026-06-03', timeOff)).toBe(true);
    expect(isOnTimeOff('r1', '2026-06-04', timeOff)).toBe(true);
    expect(isOnTimeOff('r1', '2026-06-05', timeOff)).toBe(false);
    expect(isOnTimeOff('other', '2026-06-03', timeOff)).toBe(false);
  });

  it('covers people and placeholders but not external resources', () => {
    const closure = makeClosure();
    const personal = makeTimeOff({
      id: 'personal',
      resourceId: 'r1',
      startDate: '2026-06-04',
      endDate: '2026-06-04',
    });

    expect(isOnClosure(makeResource(), '2026-06-03', [closure])).toBe(true);
    expect(isOnClosure(makeResource({ kind: 'placeholder' }), '2026-06-03', [closure])).toBe(true);
    expect(isOnClosure(makeResource({ kind: 'external' }), '2026-06-03', [closure])).toBe(false);
    expect(isOnTimeOff('r1', '2026-06-04', [personal])).toBe(true);
  });

  it('treats a closure as a literal inclusive span across a weekend', () => {
    const closure = makeClosure({ startDate: '2026-06-05', endDate: '2026-06-08' });

    expect(isOnClosure(r, '2026-06-05', [closure])).toBe(true);
    expect(isOnClosure(r, '2026-06-06', [closure])).toBe(true);
    expect(isOnClosure(r, '2026-06-07', [closure])).toBe(true);
    expect(isOnClosure(r, '2026-06-08', [closure])).toBe(true);
  });

  it('uses fixed eight-hour full days, four-hour half days, and zero for non-working/time-off days', () => {
    expect(availableHoursOnDay({ resource: r, date: '2026-06-01', timeOff: [] })).toBe(8);
    expect(
      availableHoursOnDay({
        resource: makeResource({ workingHoursPerDay: 6, halfDays: [2] }),
        date: '2026-06-02',
        timeOff: [],
      }),
    ).toBe(4);
    expect(
      availableHoursOnDay({
        resource: makeResource({ workingHoursPerDay: 6 }),
        date: '2026-06-01',
        timeOff: [],
      }),
    ).toBe(8);
    expect(availableHoursOnDay({ resource: r, date: '2026-06-06', timeOff: [] })).toBe(0);
    expect(
      availableHoursOnDay({
        resource: makeResource({ halfDays: [3] }),
        date: '2026-06-03',
        timeOff: [makeTimeOff()],
      }),
    ).toBe(0);
  });
});

describe('allocatedHoursOnDay', () => {
  const r = makeResource();
  it('sums overlapping allocations for the resource only', () => {
    const allocs = [
      makeAlloc({
        id: 'a1',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        hoursPerDay: 4,
      }),
      makeAlloc({
        id: 'a2',
        startDate: '2026-06-03',
        endDate: '2026-06-03',
        hoursPerDay: 3,
      }),
      makeAlloc({
        id: 'a3',
        resourceId: 'other',
        startDate: '2026-06-03',
        endDate: '2026-06-03',
        hoursPerDay: 9,
      }),
    ];
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-02', allocations: allocs })).toBe(4);
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-03', allocations: allocs })).toBe(7);
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-10', allocations: allocs })).toBe(0);
  });

  it('a weekend-aware allocation does no work on a weekend it merely spans', () => {
    // Fri 06-05 .. Mon 06-08 spans Sat 06-06 / Sun 06-07. The default (weekend-aware)
    // allocation works only the resource's weekdays, so the weekend contributes 0.
    const allocs = [
      makeAlloc({
        startDate: '2026-06-05',
        endDate: '2026-06-08',
        hoursPerDay: 8,
      }),
    ];
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-05', allocations: allocs })).toBe(8);
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-06', allocations: allocs })).toBe(0);
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-07', allocations: allocs })).toBe(0);
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-08', allocations: allocs })).toBe(8);
  });

  it('an ignoreWorkingDays allocation places its hours on the weekend AND still on its working days', () => {
    const allocs = [
      makeAlloc({
        startDate: '2026-06-05',
        endDate: '2026-06-08',
        hoursPerDay: 8,
        ignoreWorkingDays: true,
      }),
    ];
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-05', allocations: allocs })).toBe(8);
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-06', allocations: allocs })).toBe(8);
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-07', allocations: allocs })).toBe(8);
    expect(allocatedHoursOnDay({ resource: r, date: '2026-06-08', allocations: allocs })).toBe(8);
  });

  it('skips a non-working WEEKDAY too, not just Sat/Sun (a Mon–Wed part-timer)', () => {
    // The narrowed rule is about non-working days, not literally weekends: a Mon–Wed resource works
    // none of Thu/Fri/Sat/Sun, so a weekend-aware allocation spanning into them does no work there.
    const monWed = makeResource({ workingDays: [1, 2, 3] });
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        hoursPerDay: 8,
      }),
    ];
    expect(allocatedHoursOnDay({ resource: monWed, date: '2026-06-03', allocations: allocs })).toBe(
      8,
    );
    expect(allocatedHoursOnDay({ resource: monWed, date: '2026-06-04', allocations: allocs })).toBe(
      0,
    );
    expect(allocatedHoursOnDay({ resource: monWed, date: '2026-06-05', allocations: allocs })).toBe(
      0,
    );
  });
});

describe('isHalfDay', () => {
  it("reads the resource's saved half-day pattern for a weekday", () => {
    const r = makeResource({ halfDays: [3] });
    expect(isHalfDay(r, 3)).toBe(true);
    expect(isHalfDay(r, 2)).toBe(false);
  });
});
