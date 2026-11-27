import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields'

import { describe, expect, it } from 'vitest'
import type { CapacitySection } from '@capacitylens/shared/lib/capacity'
import {
  addDaysISO,
  listDaysISO,
  startOfWeekISO,
  getWeekday,
} from '@capacitylens/shared/lib/dateMath'
import type { AppData, ISODate, Resource, Weekday } from '@capacitylens/shared/types/entities'
import { createEmptyAppData } from '@capacitylens/shared/types/entities'
import { capacityOver, onlyRange } from '@/test/capacityFixtures'
import type { ServerDayFigures } from '@/test/capacityFixtures'
import { buildCapacityOverviewPeriods } from './capacityOverviewDates'
import { buildCapacityOverviewModel } from './capacityOverviewModel'
import type { CapacityOverviewModel } from './capacityOverviewModel'

const COMPANY_ID = 'company-1'
const BASE = {
  companyId: COMPANY_ID,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5]

function person(id: string, overrides: Partial<Resource> = {}): Resource {
  return {
    ...NULLABLE_FIELDS.resources,
    ...BASE,
    id,
    kind: 'person',
    name: id,
    jobTitle: 'Designer',
    employmentType: 'permanent',
    engagement: 'studio',
    workingHoursPerDay: 8,
    workingDays: WEEKDAYS,
    halfDays: [],
    color: '#111111',
    ...overrides,
  }
}

function placeholder(id: string, overrides: Partial<Resource> = {}): Resource {
  return person(id, { kind: 'placeholder', jobTitle: 'Designer', ...overrides })
}

function data(resources: Resource[]): AppData {
  return { ...createEmptyAppData(), resources }
}

/** The server's figures over the twelve-week horizon from `today`: eight hours on each weekday and
 * none at weekends, nothing allocated, then each resource's figures for the dates it names. */
function horizonCapacity(
  today: ISODate,
  resources: Record<string, Record<ISODate, ServerDayFigures>>
): CapacitySection {
  const range = { from: today, to: addDaysISO(startOfWeekISO(today, 1), 83) }
  const weekends = Object.fromEntries(
    listDaysISO(range.from, range.to)
      .filter((date) => getWeekday(date) === 0 || getWeekday(date) === 6)
      .map((date) => [date, { available: 0 }])
  )
  return capacityOver(
    range,
    Object.fromEntries(
      Object.entries(resources).map(([id, byDate]) => [id, { byDate: { ...weekends, ...byDate } }])
    )
  )
}

/** The same figures on each date from `from` to `to`. */
function onDates(from: ISODate, to: ISODate, figures: ServerDayFigures) {
  return Object.fromEntries(listDaysISO(from, to).map((date) => [date, figures]))
}

function period(model: CapacityOverviewModel, rowId: string, index: number) {
  const row = model.groups
    .flatMap((group) => group.rows)
    .find((candidate) => candidate.resource.id === rowId)
  if (!row) throw new Error(`Missing overview row ${rowId}`)
  const result = row.periods[index]
  if (!result) throw new Error(`Missing overview period ${index}`)
  return result
}

describe('buildCapacityOverviewPeriods', () => {
  it('builds the remaining current period followed by three full company periods', () => {
    expect(buildCapacityOverviewPeriods({ today: '2026-06-03', weekStartsOn: 1 })).toEqual([
      { index: 0, key: 'this-week', start: '2026-06-03', end: '2026-06-07', partial: true },
      { index: 1, key: 'next-week', start: '2026-06-08', end: '2026-06-14', partial: false },
      { index: 2, key: 'week-3', start: '2026-06-15', end: '2026-06-21', partial: false },
      { index: 3, key: 'week-4', start: '2026-06-22', end: '2026-06-28', partial: false },
    ])
  })

  it('respects a Sunday company week start', () => {
    expect(buildCapacityOverviewPeriods({ today: '2026-06-06', weekStartsOn: 0 })[0]).toEqual({
      index: 0,
      key: 'this-week',
      start: '2026-06-06',
      end: '2026-06-06',
      partial: true,
    })
    expect(buildCapacityOverviewPeriods({ today: '2026-06-06', weekStartsOn: 0 })[1]).toMatchObject(
      {
        start: '2026-06-07',
        end: '2026-06-13',
      }
    )
  })

  it('adds complete single weeks for the eight- and twelve-week horizons', () => {
    const eight = buildCapacityOverviewPeriods({
      today: '2026-06-03',
      weekStartsOn: 1,
      horizon: '8-weeks',
    })
    const twelve = buildCapacityOverviewPeriods({
      today: '2026-06-03',
      weekStartsOn: 1,
      horizon: '12-weeks',
    })

    expect(eight).toHaveLength(8)
    expect(twelve).toHaveLength(12)
    expect(twelve.slice(0, 8)).toEqual(eight)
    expect(twelve[4]).toEqual({
      index: 4,
      key: 'week-5',
      start: '2026-06-29',
      end: '2026-07-05',
      partial: false,
    })
    expect(twelve[11]).toEqual({
      index: 11,
      key: 'week-12',
      start: '2026-08-17',
      end: '2026-08-23',
      partial: false,
    })
  })

  it('keeps later weeks contiguous across Sunday-start and year boundaries', () => {
    const periods = buildCapacityOverviewPeriods({
      today: '2026-12-30',
      weekStartsOn: 0,
      horizon: '12-weeks',
    })

    expect(periods.slice(0, 5).map(({ key, start, end }) => ({ key, start, end }))).toEqual([
      { key: 'this-week', start: '2026-12-30', end: '2027-01-02' },
      { key: 'next-week', start: '2027-01-03', end: '2027-01-09' },
      { key: 'week-3', start: '2027-01-10', end: '2027-01-16' },
      { key: 'week-4', start: '2027-01-17', end: '2027-01-23' },
      { key: 'week-5', start: '2027-01-24', end: '2027-01-30' },
    ])
    expect(periods[11]).toMatchObject({ key: 'week-12', start: '2027-03-14', end: '2027-03-20' })
  })
})

describe('buildCapacityOverviewModel', () => {
  it('filters a person by availability in any displayed week, including later horizon weeks', () => {
    const resource = person('later', { workingDays: [1] })
    // Mondays only, booked in full for four weeks and to six hours in the fifth.
    const capacity = horizonCapacity('2026-06-01', {
      [resource.id]: {
        ...onDates('2026-06-01', '2026-08-23', { available: 0 }),
        ...Object.fromEntries(
          listDaysISO('2026-06-01', '2026-08-23')
            .filter((date) => getWeekday(date) === 1)
            .map((date) => [
              date,
              { allocated: date <= '2026-06-22' ? 8 : date === '2026-06-29' ? 6 : 0 },
            ])
        ),
      },
    })
    const twelveWeekResult = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      weekStartsOn: 1,
      capacity,
      horizon: '12-weeks',
      hasAvailability: true,
      disciplinesEnabled: false,
    })
    const fourWeekResult = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      weekStartsOn: 1,
      capacity,
      hasAvailability: true,
      disciplinesEnabled: false,
    })

    const row = twelveWeekResult.groups[0]?.rows[0]
    expect(row?.periods).toHaveLength(12)
    expect(row?.periods[4]).toMatchObject({ freeHours: 2, freeDays: 0.25, state: 'available' })
    expect(row?.periods[5]).toMatchObject({ freeHours: 8, freeDays: 1 })
    expect(fourWeekResult.groups).toHaveLength(0)
  })

  it('includes placeholder demand only in a displayed week and excludes tentative demand', () => {
    const confirmedSlot = placeholder('confirmed-slot')
    const tentativeSlot = placeholder('tentative-slot')
    const capacity = horizonCapacity('2026-06-01', {
      [confirmedSlot.id]: { '2026-06-29': { allocated: 1 } },
      [tentativeSlot.id]: { '2026-07-06': { allocated: 1, confirmedAllocated: 0 } },
    })
    const twelveWeekResult = buildCapacityOverviewModel({
      data: data([confirmedSlot, tentativeSlot]),
      today: '2026-06-01',
      weekStartsOn: 1,
      capacity,
      horizon: '12-weeks',
      placeholdersEnabled: true,
      hasAvailability: true,
      disciplinesEnabled: false,
    })
    const fourWeekResult = buildCapacityOverviewModel({
      data: data([confirmedSlot]),
      today: '2026-06-01',
      weekStartsOn: 1,
      capacity,
      placeholdersEnabled: true,
      hasAvailability: true,
      disciplinesEnabled: false,
    })
    const hiddenTentativeResult = buildCapacityOverviewModel({
      data: data([tentativeSlot]),
      today: '2026-06-01',
      weekStartsOn: 1,
      capacity,
      horizon: '12-weeks',
      includeTentative: false,
      placeholdersEnabled: true,
      hasAvailability: true,
      disciplinesEnabled: false,
    })

    expect(
      twelveWeekResult.groups.flatMap((group) => group.rows).map(({ resource }) => resource.id)
    ).toEqual([confirmedSlot.id, tentativeSlot.id])
    expect(period(twelveWeekResult, confirmedSlot.id, 4)).toMatchObject({
      unassignedDemandHours: 1,
      unassignedDemandDays: 0.25,
    })
    expect(fourWeekResult.groups).toHaveLength(0)
    expect(hiddenTentativeResult.groups).toHaveLength(0)
  })

  it('keeps daily spare and overload separate before quarter-day rounding', () => {
    const resource = person('person-1')
    const result = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      capacity: horizonCapacity('2026-06-01', {
        [resource.id]: {
          '2026-06-03': { allocated: 10, over: true },
          '2026-06-04': { allocated: 1 },
        },
      }),
      weekStartsOn: 1,
      disciplinesEnabled: false,
    })

    expect(period(result, resource.id, 0)).toMatchObject({
      availableHours: 40,
      freeHours: 31,
      overHours: 2,
      freeDays: 3.75,
      overDays: 0.25,
      state: 'available',
    })
  })

  it('floors free capacity and ceils overload after precise weekly aggregation', () => {
    const resource = person('person-1')
    const result = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      capacity: horizonCapacity('2026-06-01', {
        [resource.id]: onDates('2026-06-01', '2026-06-02', { allocated: 7 }),
      }),
      disciplinesEnabled: false,
    })

    expect(period(result, resource.id, 0)).toMatchObject({
      freeHours: 26,
      overHours: 0,
      freeDays: 3.25,
    })
  })

  it('marks a working week fully booked and a zero-capacity week unavailable', () => {
    const working = person('working')
    const away = person('away')
    const result = buildCapacityOverviewModel({
      data: data([working, away]),
      today: '2026-06-01',
      capacity: horizonCapacity('2026-06-01', {
        [working.id]: onDates('2026-06-01', '2026-06-05', { allocated: 8 }),
        [away.id]: onDates('2026-06-01', '2026-06-05', { available: 0 }),
      }),
      disciplinesEnabled: false,
    })

    expect(period(result, working.id, 0).state).toBe('fully-booked')
    expect(period(result, away.id, 0).state).toBe('unavailable')
  })

  it('treats less than a quarter-day of precise spare time as fully booked', () => {
    const resource = person('almost-full')
    const result = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      capacity: horizonCapacity('2026-06-01', {
        [resource.id]: onDates('2026-06-01', '2026-06-05', { allocated: 7.8 }),
      }),
      disciplinesEnabled: false,
    })

    const resultPeriod = period(result, resource.id, 0)
    expect(resultPeriod.availableHours).toBe(40)
    expect(resultPeriod.freeHours).toBeCloseTo(1)
    expect(resultPeriod.freeDays).toBe(0)
    expect(resultPeriod.state).toBe('fully-booked')
  })

  it('reads each period from the dates of the server horizon, starting at today', () => {
    const resource = person('person-1')
    // Today is a Wednesday, so the first period runs from the horizon's first date to Sunday.
    const result = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-03',
      capacity: onlyRange(
        horizonCapacity('2026-06-03', {
          [resource.id]: { '2026-06-03': { allocated: 8 }, '2026-06-08': { allocated: 4 } },
        }),
        'horizon'
      ),
      weekStartsOn: 1,
      disciplinesEnabled: false,
    })

    expect(period(result, resource.id, 0)).toMatchObject({ availableHours: 24, freeHours: 16 })
    expect(period(result, resource.id, 1)).toMatchObject({ availableHours: 40, freeHours: 36 })
  })

  it('counts nothing for a resource the server sent no figures for', () => {
    const resource = person('person-1')
    const result = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      capacity: horizonCapacity('2026-06-01', {}),
      disciplinesEnabled: false,
    })

    expect(period(result, resource.id, 0)).toMatchObject({
      availableHours: 0,
      state: 'unavailable',
    })
  })

  it('excludes tentative load when requested', () => {
    const resource = person('person-1')
    const capacity = horizonCapacity('2026-06-01', {
      [resource.id]: onDates('2026-06-01', '2026-06-05', { allocated: 8, confirmedAllocated: 0 }),
    })
    const included = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      capacity,
      disciplinesEnabled: false,
    })
    const excluded = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      capacity,
      includeTentative: false,
      disciplinesEnabled: false,
    })

    expect(period(included, resource.id, 0).freeDays).toBe(0)
    expect(period(excluded, resource.id, 0).freeDays).toBe(5)
  })

  it('measures tentative work as the free time it consumes, clamped to real spare capacity', () => {
    const resource = person('person-1')
    // Monday carries 8h confirmed and 4h tentative; Tuesday and Wednesday 8h tentative each.
    const capacity = horizonCapacity('2026-06-01', {
      [resource.id]: {
        '2026-06-01': { allocated: 12, confirmedAllocated: 8, over: true },
        ...onDates('2026-06-02', '2026-06-03', { allocated: 8, confirmedAllocated: 0 }),
      },
    })
    const included = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      capacity,
      disciplinesEnabled: false,
    })
    const excluded = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      capacity,
      includeTentative: false,
      disciplinesEnabled: false,
    })

    // Monday is already full with confirmed work, so its tentative 4h is overload, not tentative
    // free time; Tuesday and Wednesday's 16h are free time held tentatively.
    expect(period(included, resource.id, 0)).toMatchObject({
      freeHours: 16,
      freeDays: 2,
      tentativeHours: 16,
      tentativeDays: 2,
      overHours: 4,
    })
    expect(period(excluded, resource.id, 0)).toMatchObject({
      freeHours: 32,
      tentativeHours: 0,
      overHours: 0,
    })
  })

  it('excludes tentative placeholder demand when requested', () => {
    const slot = placeholder('slot')
    const capacity = horizonCapacity('2026-06-01', {
      [slot.id]: { '2026-06-01': { allocated: 8, confirmedAllocated: 0 } },
    })
    const included = buildCapacityOverviewModel({
      data: data([slot]),
      today: '2026-06-01',
      capacity,
      placeholdersEnabled: true,
      disciplinesEnabled: false,
    })
    const excluded = buildCapacityOverviewModel({
      data: data([slot]),
      today: '2026-06-01',
      capacity,
      includeTentative: false,
      placeholdersEnabled: true,
      disciplinesEnabled: false,
    })

    expect(period(included, slot.id, 0).unassignedDemandDays).toBe(1)
    expect(period(excluded, slot.id, 0).unassignedDemandDays).toBe(0)
  })

  it('shows placeholder demand separately, without free capacity or people totals', () => {
    const real = person('real')
    const slot = placeholder('slot')
    const result = buildCapacityOverviewModel({
      data: data([real, slot]),
      today: '2026-06-01',
      capacity: horizonCapacity('2026-06-01', {
        [real.id]: {},
        [slot.id]: onDates('2026-06-01', '2026-06-02', { allocated: 8 }),
      }),
      placeholdersEnabled: true,
      disciplinesEnabled: false,
    })
    const slotPeriod = period(result, slot.id, 0)

    expect(slotPeriod).toMatchObject({
      freeDays: 0,
      overDays: 0,
      unassignedDemandHours: 16,
      unassignedDemandDays: 2,
    })
    expect(period(result, real.id, 0)).toMatchObject({ freeDays: 5 })
  })

  it('derives disabled-discipline fallback groups and keeps placeholder demand visibly separate', () => {
    const studio = person('studio', { engagement: 'studio' })
    const supplementary = person('supplementary', { engagement: 'supplementary' })
    const slot = placeholder('slot', { engagement: 'studio' })
    const grouped = buildCapacityOverviewModel({
      data: data([studio, supplementary, slot]),
      today: '2026-06-01',
      capacity: null,
      placeholdersEnabled: true,
      disciplinesEnabled: false,
    })

    const ungrouped = buildCapacityOverviewModel({
      data: data([studio, slot]),
      today: '2026-06-01',
      capacity: null,
      placeholdersEnabled: true,
      disciplinesEnabled: false,
    })

    expect(grouped.groups.map((group) => group.key)).toEqual([
      'engagement-studio',
      'engagement-supplementary',
      'placeholders',
    ])
    expect(ungrouped.groups.map((group) => group.key)).toEqual(['overall', 'placeholders'])
  })

  it('keeps placeholder demand separate from discipline groups', () => {
    const designer = person('designer', { disciplineId: 'design' })
    const slot = placeholder('slot', { disciplineId: 'design' })
    const result = buildCapacityOverviewModel({
      data: {
        ...data([designer, slot]),
        disciplines: [
          { ...NULLABLE_FIELDS.disciplines, ...BASE, id: 'design', name: 'Design', sortOrder: 0 },
        ],
      },
      today: '2026-06-01',
      capacity: null,
      placeholdersEnabled: true,
      disciplinesEnabled: true,
    })

    expect(result.groups.map((group) => group.key)).toEqual(['design', 'placeholders'])
    expect(result.groups[0]?.rows.map((row) => row.resource.id)).toEqual([designer.id])
    expect(result.groups[1]?.rows.map((row) => row.resource.id)).toEqual([slot.id])
  })

  it('keeps placeholders under Has availability when they have demand and filters people by any quarter day', () => {
    const available = person('available')
    const full = person('full')
    const slot = placeholder('slot')
    const result = buildCapacityOverviewModel({
      data: data([available, full, slot]),
      today: '2026-06-01',
      capacity: horizonCapacity('2026-06-01', {
        [available.id]: {},
        [full.id]: Object.fromEntries(
          listDaysISO('2026-06-01', '2026-06-26')
            .filter((date) => getWeekday(date) !== 0 && getWeekday(date) !== 6)
            .map((date) => [date, { allocated: 8 }])
        ),
        [slot.id]: { '2026-06-08': { allocated: 1 } },
      }),
      placeholdersEnabled: true,
      hasAvailability: true,
      disciplinesEnabled: false,
    })
    const visible = result.groups.flatMap((group) => group.rows).map((row) => row.resource.id)

    expect(visible).toEqual([available.id, slot.id])
    expect(result.groups.map((group) => group.rows.length)).toEqual([1, 1])
  })

  it('follows discipline and engagement ordering while excluding external and archived resources', () => {
    const first = person('z-person', { engagement: 'supplementary', disciplineId: 'design' })
    const second = person('a-person', { disciplineId: 'design' })
    const archived = person('archived', {
      disciplineId: 'design',
      archivedAt: '2026-01-02T00:00:00.000Z',
    })
    const external = person('external', { kind: 'external', disciplineId: 'design' })
    const result = buildCapacityOverviewModel({
      data: {
        ...data([first, second, archived, external]),
        disciplines: [
          { ...NULLABLE_FIELDS.disciplines, ...BASE, id: 'design', name: 'Design', sortOrder: 0 },
          {
            ...NULLABLE_FIELDS.disciplines,
            ...BASE,
            id: 'development',
            name: 'Development',
            sortOrder: 1,
          },
        ],
      },
      today: '2026-06-01',
      capacity: null,
      disciplinesEnabled: true,
    })

    expect(result.groups.map((group) => group.key)).toEqual(['design'])
    expect(result.groups[0]?.rows.map((row) => row.resource.id)).toEqual([second.id, first.id])
  })

  it('keeps exact hours on every row so totals can sum before rounding', () => {
    const first = person('first')
    const second = person('second')
    const result = buildCapacityOverviewModel({
      data: data([first, second]),
      today: '2026-06-01',
      capacity: horizonCapacity('2026-06-01', {
        [first.id]: {
          '2026-06-01': { allocated: 7 },
          '2026-06-08': { allocated: 10, over: true },
          '2026-06-09': { available: 0 },
        },
        [second.id]: { '2026-06-01': { allocated: 7 } },
      }),
      disciplinesEnabled: false,
    })

    expect(period(result, first.id, 0)).toMatchObject({ freeHours: 33, freeDays: 4 })
    expect(period(result, second.id, 0)).toMatchObject({ freeHours: 33, freeDays: 4 })
    expect(period(result, first.id, 1)).toMatchObject({
      availableHours: 32,
      freeHours: 24,
      overHours: 2,
    })
    expect(period(result, second.id, 1)).toMatchObject({
      availableHours: 40,
      freeHours: 40,
      overHours: 0,
    })
  })

  it('returns a measured-capacity explanation in Blocks mode', () => {
    const resource = person('person-1')
    const result = buildCapacityOverviewModel({
      data: data([resource]),
      today: '2026-06-01',
      capacity: horizonCapacity('2026-06-01', { [resource.id]: {} }),
      blocksMode: true,
    })

    expect(result).toMatchObject({ measured: false, reason: 'blocks-mode', groups: [] })
  })
})
