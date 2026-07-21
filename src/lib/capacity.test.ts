import { describe, it, expect, vi } from 'vitest'
import {
  allocatedHoursOnDay,
  availableHoursOnDay,
  capacityAdvisory,
  capacityForWindow,
  dayCapacity,
  isOnTimeOff,
  isWorkingDay,
  overAllocatedInWindow,
  utilization,
} from './capacity'
import { eachDayISO } from '@capacitylens/shared/lib/dateMath'
import type { Allocation, Resource, TimeOff } from '@capacitylens/shared/types/entities'

const makeResource = (over: Partial<Resource> = {}): Resource => ({
  id: 'r1',
  accountId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  kind: 'person',
  role: 'Developer',
  employmentType: 'permanent',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5], // Mon–Fri
  color: '#000',
  ...over,
})

const makeAlloc = (over: Partial<Allocation> = {}): Allocation => ({
  id: 'a1',
  accountId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  resourceId: 'r1',
  activityId: 'activity1',
  startDate: '2026-06-01',
  endDate: '2026-06-05',
  hoursPerDay: 4,
  status: 'confirmed',
  ...over,
})

const makeTimeOff = (over: Partial<TimeOff> = {}): TimeOff => ({
  id: 'to1',
  accountId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  resourceId: 'r1',
  startDate: '2026-06-03',
  endDate: '2026-06-03',
  type: 'holiday',
  ...over,
})

describe('availability', () => {
  const r = makeResource()

  it('knows working vs non-working weekdays', () => {
    expect(isWorkingDay(r, '2026-06-01')).toBe(true) // Monday
    expect(isWorkingDay(r, '2026-06-06')).toBe(false) // Saturday
    expect(isWorkingDay(r, '2026-06-07')).toBe(false) // Sunday
  })

  it('detects time off ranges', () => {
    const timeOff = [makeTimeOff({ startDate: '2026-06-03', endDate: '2026-06-04' })]
    expect(isOnTimeOff('r1', '2026-06-03', timeOff)).toBe(true)
    expect(isOnTimeOff('r1', '2026-06-04', timeOff)).toBe(true)
    expect(isOnTimeOff('r1', '2026-06-05', timeOff)).toBe(false)
    expect(isOnTimeOff('other', '2026-06-03', timeOff)).toBe(false)
  })

  it('available hours are 0 on weekends and time off, else workingHoursPerDay', () => {
    expect(availableHoursOnDay(r, '2026-06-01', [])).toBe(8) // Monday
    expect(availableHoursOnDay(r, '2026-06-06', [])).toBe(0) // Saturday
    expect(availableHoursOnDay(r, '2026-06-03', [makeTimeOff()])).toBe(0) // time off
  })
})

describe('devAssertFinite (DEV-only console.warn on a non-finite value)', () => {
  const r = makeResource()

  it('warns when workingHoursPerDay is not finite', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    availableHoursOnDay(makeResource({ workingHoursPerDay: NaN }), '2026-06-01', []) // Monday
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('workingHoursPerDay')
    expect(warn.mock.calls[0][0]).toContain('is not a finite number')
    expect(warn.mock.calls[0][0]).toContain('should have prevented this')
    warn.mockRestore()
  })

  it('does not warn when workingHoursPerDay is finite', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    availableHoursOnDay(r, '2026-06-01', []) // Monday, finite workingHoursPerDay
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('warns with the "allocated hours sum" label when the summed allocation hours are not finite', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: NaN })]
    allocatedHoursOnDay(r, '2026-06-01', allocs)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('allocated hours sum')
    warn.mockRestore()
  })
})

describe('allocatedHoursOnDay', () => {
  const r = makeResource() // Mon–Fri

  it('sums overlapping allocations for the resource only', () => {
    const allocs = [
      makeAlloc({ id: 'a1', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 4 }),
      makeAlloc({ id: 'a2', startDate: '2026-06-03', endDate: '2026-06-03', hoursPerDay: 3 }),
      makeAlloc({ id: 'a3', resourceId: 'other', startDate: '2026-06-03', endDate: '2026-06-03', hoursPerDay: 9 }),
    ]
    expect(allocatedHoursOnDay(r, '2026-06-02', allocs)).toBe(4)
    expect(allocatedHoursOnDay(r, '2026-06-03', allocs)).toBe(7) // 4 + 3, ignoring other resource
    expect(allocatedHoursOnDay(r, '2026-06-10', allocs)).toBe(0)
  })

  it('a weekend-aware allocation does no work on a weekend it merely spans', () => {
    // Fri 06-05 .. Mon 06-08 spans Sat 06-06 / Sun 06-07. The default (weekend-aware)
    // allocation works only the resource's weekdays, so the weekend contributes 0.
    const allocs = [makeAlloc({ startDate: '2026-06-05', endDate: '2026-06-08', hoursPerDay: 8 })]
    expect(allocatedHoursOnDay(r, '2026-06-05', allocs)).toBe(8) // Fri (working)
    expect(allocatedHoursOnDay(r, '2026-06-06', allocs)).toBe(0) // Sat (spanned, no work)
    expect(allocatedHoursOnDay(r, '2026-06-07', allocs)).toBe(0) // Sun (spanned, no work)
    expect(allocatedHoursOnDay(r, '2026-06-08', allocs)).toBe(8) // Mon (working)
  })

  it('an ignoreWeekends allocation places its hours on the weekend AND still on its working days', () => {
    const allocs = [
      makeAlloc({ startDate: '2026-06-05', endDate: '2026-06-08', hoursPerDay: 8, ignoreWeekends: true }),
    ]
    expect(allocatedHoursOnDay(r, '2026-06-05', allocs)).toBe(8) // Fri (working — still covered)
    expect(allocatedHoursOnDay(r, '2026-06-06', allocs)).toBe(8) // Sat (opted in)
    expect(allocatedHoursOnDay(r, '2026-06-07', allocs)).toBe(8) // Sun (opted in)
    expect(allocatedHoursOnDay(r, '2026-06-08', allocs)).toBe(8) // Mon (working — still covered)
  })

  it('skips a non-working WEEKDAY too, not just Sat/Sun (a Mon–Wed part-timer)', () => {
    // The narrowed rule is about NON-WORKING days, not literally weekends: a Mon–Wed resource works
    // none of Thu/Fri/Sat/Sun, so a weekend-aware allocation spanning into them does no work there.
    const monWed = makeResource({ workingDays: [1, 2, 3] })
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8 })]
    expect(allocatedHoursOnDay(monWed, '2026-06-03', allocs)).toBe(8) // Wed (working)
    expect(allocatedHoursOnDay(monWed, '2026-06-04', allocs)).toBe(0) // Thu (non-working weekday)
    expect(allocatedHoursOnDay(monWed, '2026-06-05', allocs)).toBe(0) // Fri (non-working weekday)
  })
})

describe('dayCapacity over-allocation', () => {
  const r = makeResource()

  it('flags over when allocated exceeds available', () => {
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 10 })]
    const cap = dayCapacity(r, '2026-06-01', allocs, [])
    expect(cap).toMatchObject({ allocated: 10, available: 8, over: true })
  })

  it('a weekend a bar merely spans is NOT over (weekends are not counted by default)', () => {
    // Fri 06-05 .. Mon 06-08 spans the weekend; the weekend-aware allocation does no work on
    // Sat/Sun, so allocated is 0 there and the day is not over (just the grey "unavailable" tint).
    const allocs = [makeAlloc({ startDate: '2026-06-05', endDate: '2026-06-08', hoursPerDay: 8 })]
    const cap = dayCapacity(r, '2026-06-06', allocs, []) // Saturday
    expect(cap).toMatchObject({ allocated: 0, available: 0, over: false })
  })

  it('a weekend IS over when the allocation opts in via ignoreWeekends', () => {
    // "Include weekends as working days" makes the hours land on Sat/Sun; a Mon–Fri person has
    // 0 weekend capacity, so that weekend work honestly reads as over.
    const allocs = [
      makeAlloc({ startDate: '2026-06-06', endDate: '2026-06-06', hoursPerDay: 2, ignoreWeekends: true }),
    ]
    const cap = dayCapacity(r, '2026-06-06', allocs, []) // Saturday
    expect(cap).toMatchObject({ allocated: 2, available: 0, over: true })
  })

  it('work scheduled on a time-off day is still over (a real conflict, unlike a spanned weekend)', () => {
    // Wed 06-03 is a working weekday the resource is on holiday — available 0, but the allocation
    // genuinely works that day, so it stays red. Time-off is deliberately distinct from weekends.
    const allocs = [makeAlloc({ startDate: '2026-06-03', endDate: '2026-06-03', hoursPerDay: 4 })]
    const cap = dayCapacity(r, '2026-06-03', allocs, [makeTimeOff({ startDate: '2026-06-03', endDate: '2026-06-03' })])
    expect(cap).toMatchObject({ allocated: 4, available: 0, over: true })
  })

  it("a part-timer's non-working WEEKDAY a bar spans is NOT over (the rule is non-working days, not just Sat/Sun)", () => {
    // Mon–Wed resource; a weekend-aware allocation spanning into Thu 06-04 does no work there.
    const monWed = makeResource({ workingDays: [1, 2, 3] })
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8 })]
    expect(dayCapacity(monWed, '2026-06-04', allocs, [])).toMatchObject({ allocated: 0, available: 0, over: false }) // Thu
    expect(dayCapacity(monWed, '2026-06-02', allocs, []).over).toBe(false) // Tue (working, at capacity)
  })

  it('is not over when within available hours', () => {
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 8 })]
    expect(dayCapacity(r, '2026-06-01', allocs, []).over).toBe(false)
  })

  // The acceptance boundary: "over" is STRICTLY allocated > available. Exactly AT capacity
  // (8 vs 8) is NOT over (no red); one hour over (9 vs 8) IS over (red). Lock both ends.
  it('is NOT over when EXACTLY at capacity (8 vs 8) — the strict boundary, not red', () => {
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 8 })]
    const cap = dayCapacity(r, '2026-06-01', allocs, [])
    expect(cap).toMatchObject({ allocated: 8, available: 8, over: false })
  })

  it('IS over when just one hour over capacity (9 vs 8)', () => {
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 9 })]
    const cap = dayCapacity(r, '2026-06-01', allocs, [])
    expect(cap).toMatchObject({ allocated: 9, available: 8, over: true })
  })
})

describe('utilization', () => {
  const r = makeResource()

  it('is allocated / available over working days in the window', () => {
    // Window Mon 06-01 .. Sun 06-07: available = 5 * 8 = 40
    // Allocate 4h/day Mon–Fri = 20 -> 0.5
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 4 })]
    expect(utilization(r, allocs, [], '2026-06-01', '2026-06-07')).toBeCloseTo(0.5)
  })

  it('returns 0 when there is no availability in the window', () => {
    // A weekend-only window for a Mon–Fri resource has no availability.
    expect(utilization(r, [makeAlloc()], [], '2026-06-06', '2026-06-07')).toBe(0)
  })

  it('does not exceed 100% for a full booking that merely spans a weekend', () => {
    // Mon 06-01 .. Sun 06-14: 10 working days × 8h = 80h available. A continuous
    // 8h/day allocation across the whole window books weekend days too, but those
    // hours must not inflate the ratio — a fully-booked person reads as 100%, not 140%.
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-14', hoursPerDay: 8 })]
    expect(utilization(r, allocs, [], '2026-06-01', '2026-06-14')).toBeCloseTo(1)
  })

  it('accepts an optional precomputed day array (capacityForWindow) and matches the derived-internally result', () => {
    // buildSchedulerModel hoists eachDayISO(start, end) once per window and passes it through
    // to avoid recomputing it per resource — this pins that passing it explicitly produces
    // IDENTICAL output to the default (derive-internally) path.
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 4 })]
    const precomputed = eachDayISO('2026-06-01', '2026-06-07')
    const withPrecomputed = capacityForWindow(r, allocs, [], '2026-06-01', '2026-06-07', precomputed)
    const withoutPrecomputed = capacityForWindow(r, allocs, [], '2026-06-01', '2026-06-07')
    expect(withPrecomputed).toEqual(withoutPrecomputed)
  })

  it('accepts an optional precomputed day array (utilization) and matches the derived-internally result', () => {
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 4 })]
    const precomputed = eachDayISO('2026-06-01', '2026-06-07')
    expect(utilization(r, allocs, [], '2026-06-01', '2026-06-07', precomputed)).toBeCloseTo(
      utilization(r, allocs, [], '2026-06-01', '2026-06-07'),
    )
  })

  it('does not count hours on a zero-availability day (a weekend an allocation opts into) toward the ratio', () => {
    // Sat/Sun have 0 availability for a Mon-Fri resource. An ignoreWeekends allocation still puts
    // hours there, but those days must be skipped entirely (neither side counted) — not just have
    // their availability zeroed, which would otherwise inflate the ratio via the numerator alone.
    const allocs = [
      makeAlloc({ startDate: '2026-06-06', endDate: '2026-06-07', hoursPerDay: 4, ignoreWeekends: true }),
    ]
    expect(utilization(r, allocs, [], '2026-06-01', '2026-06-07')).toBe(0)
  })
})

describe('overAllocatedInWindow', () => {
  const r = makeResource()

  it('is true when a working day is genuinely over-allocated', () => {
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 10 })] // Mon, 10h > 8h
    expect(overAllocatedInWindow(r, allocs, [], '2026-06-01', '2026-06-14')).toBe(true)
  })

  it('is false when an allocation only spans non-working (weekend) days', () => {
    // 8h/day Mon–Sun: every working day is exactly at capacity; the weekend hours
    // must not count as over-allocation for the near-term radar.
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-14', hoursPerDay: 8 })]
    expect(overAllocatedInWindow(r, allocs, [], '2026-06-01', '2026-06-14')).toBe(false)
  })

  it('is true on a zero-capacity day when an ignoreWeekends allocation books hours there', () => {
    const allocs = [
      makeAlloc({ startDate: '2026-06-06', endDate: '2026-06-06', hoursPerDay: 5, ignoreWeekends: true }),
    ]
    expect(overAllocatedInWindow(r, allocs, [], '2026-06-06', '2026-06-06')).toBe(true)
  })
})

describe('capacityAdvisory', () => {
  const r = makeResource()

  it('counts working days the proposed hours push over capacity', () => {
    const others = [makeAlloc({ hoursPerDay: 4 })] // 4h Mon–Fri 06-01..05
    const { overDays, timeOffDays } = capacityAdvisory(r, others, [], '2026-06-01', '2026-06-05', 8, false)
    expect(overDays).toBe(5) // 4 + 8 > 8 on all five weekdays
    expect(timeOffDays).toBe(0)
  })

  it('counts time-off days and excludes them from over (availability is 0 there)', () => {
    const others = [makeAlloc({ hoursPerDay: 4 })]
    const timeOff = [makeTimeOff({ startDate: '2026-06-03', endDate: '2026-06-03' })]
    const { overDays, timeOffDays } = capacityAdvisory(r, others, timeOff, '2026-06-01', '2026-06-05', 8, false)
    expect(timeOffDays).toBe(1)
    expect(overDays).toBe(4) // 06-03 is unavailable → not "over", the other 4 weekdays are
  })

  it('does not count time off on non-working days (a weekend holiday costs no capacity)', () => {
    // Resource works Mon–Fri; a holiday block falls only on the weekend 06-06..06-07.
    const timeOff = [makeTimeOff({ startDate: '2026-06-06', endDate: '2026-06-07' })]
    const { timeOffDays } = capacityAdvisory(r, [], timeOff, '2026-06-01', '2026-06-07', 8, false)
    expect(timeOffDays).toBe(0) // the resource never works those days, so it's not "on time off"
  })

  it('is clean when the proposal fits within availability', () => {
    expect(capacityAdvisory(r, [], [], '2026-06-01', '2026-06-05', 8, false)).toEqual({ overDays: 0, timeOffDays: 0 })
  })

  it('mirrors the over-marker for an ignoreWeekends weekend; weekend-aware does not', () => {
    // Fri–Sun: a weekend-aware proposal leaves Sat/Sun uncounted, but opting into weekends flags
    // them — a Mon–Fri person has 0 weekend capacity, so the advisory matches the red over-marker.
    expect(capacityAdvisory(r, [], [], '2026-06-05', '2026-06-07', 8, false).overDays).toBe(0)
    expect(capacityAdvisory(r, [], [], '2026-06-05', '2026-06-07', 8, true).overDays).toBe(2)
  })

  it('returns the zeroed advisory when the window is empty (start after end)', () => {
    expect(capacityAdvisory(r, [], [], '2026-06-05', '2026-06-01', 8, false)).toEqual({
      overDays: 0,
      timeOffDays: 0,
    })
  })

  it('clamps an existing allocation to the window start (does not count its hours before start)', () => {
    // The other allocation starts mid-window (Wed); its hours must not leak onto Mon/Tue.
    const others = [makeAlloc({ startDate: '2026-06-03', endDate: '2026-06-03', hoursPerDay: 4 })]
    const { overDays } = capacityAdvisory(r, others, [], '2026-06-01', '2026-06-03', 5, false)
    expect(overDays).toBe(1) // only Wed (4 + 5 > 8); Mon/Tue see 0 + 5, not over
  })

  it('clamps an existing allocation to the window end (does not count its hours after it ends)', () => {
    // The other allocation ends on day one (Mon); its hours must not leak onto Tue/Wed.
    const others = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 4 })]
    const { overDays } = capacityAdvisory(r, others, [], '2026-06-01', '2026-06-03', 5, false)
    expect(overDays).toBe(1) // only Mon (4 + 5 > 8); Tue/Wed see 0 + 5, not over
  })

  it('does not count an existing weekend-aware allocation on a weekend day it merely spans', () => {
    // The other allocation spans Fri-Mon but (weekend-aware, no ignoreWeekends) does no work on
    // Sat. The proposal opts INTO the weekend via ignoreWeekends with 0 hours, so a spurious
    // carry-over of the other allocation's hours onto Sat would wrongly flag it as over.
    const others = [makeAlloc({ startDate: '2026-06-05', endDate: '2026-06-08', hoursPerDay: 8 })]
    const { overDays } = capacityAdvisory(r, others, [], '2026-06-06', '2026-06-06', 0, true)
    expect(overDays).toBe(0)
  })
})
