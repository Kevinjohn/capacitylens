import { describe, it, expect } from 'vitest'
import {
  allocatedHoursOnDay,
  availableHoursOnDay,
  capacityAdvisory,
  dayCapacity,
  isOnTimeOff,
  isWorkingDay,
  overAllocatedInWindow,
  utilization,
} from './capacity'
import type { Allocation, Resource, TimeOff } from '../types/entities'

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
  taskId: 'task1',
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

describe('allocatedHoursOnDay', () => {
  it('sums overlapping allocations for the resource only', () => {
    const allocs = [
      makeAlloc({ id: 'a1', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 4 }),
      makeAlloc({ id: 'a2', startDate: '2026-06-03', endDate: '2026-06-03', hoursPerDay: 3 }),
      makeAlloc({ id: 'a3', resourceId: 'other', startDate: '2026-06-03', endDate: '2026-06-03', hoursPerDay: 9 }),
    ]
    expect(allocatedHoursOnDay('r1', '2026-06-02', allocs)).toBe(4)
    expect(allocatedHoursOnDay('r1', '2026-06-03', allocs)).toBe(7) // 4 + 3, ignoring other resource
    expect(allocatedHoursOnDay('r1', '2026-06-10', allocs)).toBe(0)
  })
})

describe('dayCapacity over-allocation', () => {
  const r = makeResource()

  it('flags over when allocated exceeds available', () => {
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 10 })]
    const cap = dayCapacity(r, '2026-06-01', allocs, [])
    expect(cap).toMatchObject({ allocated: 10, available: 8, over: true })
  })

  it('any allocation on a zero-capacity day is over', () => {
    const allocs = [makeAlloc({ startDate: '2026-06-06', endDate: '2026-06-06', hoursPerDay: 2 })]
    const cap = dayCapacity(r, '2026-06-06', allocs, []) // Saturday
    expect(cap).toMatchObject({ allocated: 2, available: 0, over: true })
  })

  it('is not over when within available hours', () => {
    const allocs = [makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 8 })]
    expect(dayCapacity(r, '2026-06-01', allocs, []).over).toBe(false)
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
})

describe('capacityAdvisory', () => {
  const r = makeResource()

  it('counts working days the proposed hours push over capacity', () => {
    const others = [makeAlloc({ hoursPerDay: 4 })] // 4h Mon–Fri 06-01..05
    const { overDays, timeOffDays } = capacityAdvisory(r, others, [], '2026-06-01', '2026-06-05', 8)
    expect(overDays).toBe(5) // 4 + 8 > 8 on all five weekdays
    expect(timeOffDays).toBe(0)
  })

  it('counts time-off days and excludes them from over (availability is 0 there)', () => {
    const others = [makeAlloc({ hoursPerDay: 4 })]
    const timeOff = [makeTimeOff({ startDate: '2026-06-03', endDate: '2026-06-03' })]
    const { overDays, timeOffDays } = capacityAdvisory(r, others, timeOff, '2026-06-01', '2026-06-05', 8)
    expect(timeOffDays).toBe(1)
    expect(overDays).toBe(4) // 06-03 is unavailable → not "over", the other 4 weekdays are
  })

  it('is clean when the proposal fits within availability', () => {
    expect(capacityAdvisory(r, [], [], '2026-06-01', '2026-06-05', 8)).toEqual({ overDays: 0, timeOffDays: 0 })
  })
})
