import { describe, expect, it } from 'vitest'
import type { Allocation, Weekday } from '@capacitylens/shared/types/entities'
import { getWeekday } from '@capacitylens/shared/lib/dateMath'
import { resolveEffectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek'
import { generateRepeatingStartDates } from '@capacitylens/shared/lib/repeatingDates'
import type { Draft } from '@/lib/entityDrafts'
import { buildRepeatedAllocationDrafts } from '@capacitylens/shared/lib/repeatingOccurrences'
import type { RepeatExpansionInput } from '@capacitylens/shared/lib/repeatingOccurrences'
import { resolveRepeatPattern } from './repeatingAllocations'

interface RepeatExpansionTestInput {
  schedulingMode: RepeatExpansionInput['schedulingMode']
  daysOver: number
  resource?: ReturnType<typeof resourceContext> | undefined
  companyWorkingDays?: Weekday[] | undefined
}

const baseDraft = (overrides: Partial<Draft<Allocation>> = {}): Draft<Allocation> => ({
  resourceId: 'r1',
  activityId: 'activity',
  startDate: '2027-01-31',
  endDate: '2027-02-02',
  hoursPerDay: 8,
  status: 'confirmed',
  note: 'Keep me',
  ignoreWorkingDays: false,
  ...overrides,
})

type TestRepeatResource = RepeatExpansionInput['resource'] & { workingDays: Weekday[] }

const resourceContext = (overrides: Partial<TestRepeatResource> = {}): TestRepeatResource => ({
  id: 'r1',
  kind: 'person',
  workingDays: [1, 2, 3, 4, 5],
  ...overrides,
})

const repeatContext = ({
  schedulingMode,
  daysOver,
  resource = resourceContext(),
  companyWorkingDays = [1, 2, 3, 4, 5],
}: RepeatExpansionTestInput): RepeatExpansionInput => ({
  schedulingMode,
  daysOver,
  resource,
  effectiveWeek: resolveEffectiveWorkingWeek(resource, companyWorkingDays),
})

describe('#257 characterization: repeat start-day rule', () => {
  // Permanent invariants: monthly off-day starts are created, while weekly cadences retain their anchor weekday.
  it('projects monthly occurrences even when generated starts are personally non-working', () => {
    const startDates = generateRepeatingStartDates('2026-06-01', '2026-08-01', {
      kind: 'monthly-date',
    }).startDates
    const expanded = buildRepeatedAllocationDrafts(
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-01' }),
      startDates,
      repeatContext({
        schedulingMode: 'days',
        daysOver: 1,
        resource: resourceContext({ workingDays: [1] }),
      })
    )

    expect(startDates.map(getWeekday)).toEqual([1, 3, 6])
    expect(expanded.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ['2026-06-01', '2026-06-01'],
      ['2026-07-01', '2026-07-06'],
      ['2026-08-01', '2026-08-03'],
    ])
  })

  it('preserves the weekly anchor weekday across the generated batch', () => {
    const startDates = generateRepeatingStartDates(
      '2026-06-01',
      '2026-07-27',
      resolveRepeatPattern('weekly')
    ).startDates

    expect(startDates).toHaveLength(9)
    expect(new Set(startDates.map(getWeekday))).toEqual(new Set([1]))
  })
})

describe('repeatPatternForSelection', () => {
  it('maps every repeating form choice exhaustively', () => {
    expect([
      resolveRepeatPattern('weekly'),
      resolveRepeatPattern('every-two-weeks'),
      resolveRepeatPattern('every-three-weeks'),
      resolveRepeatPattern('every-four-weeks'),
      resolveRepeatPattern('monthly'),
    ]).toEqual([
      { kind: 'weeks', interval: 1 },
      { kind: 'weeks', interval: 2 },
      { kind: 'weeks', interval: 3 },
      { kind: 'weeks', interval: 4 },
      { kind: 'monthly-date' },
    ])
  })
})
