import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields'
import { describe, it, expect } from 'vitest'
import {
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasResourceEngagementGrouping,
  canCreateInlineActivity,
  resolveDateStyle,
  hasPlaceholdersEnabled,
  buildDisciplineGroups,
  resolveSchedulingMode,
  listCompanyWorkingDays,
  resolveTimeZone,
  buildVisibleRange,
  resolveWeekStart,
  hasVisibleTaskFieldInSchedule,
} from './selectors'
import { buildEmptyFilters } from './useStore'
import { DEFAULT_COMPANY_ID, makeCompany, makeResource } from '@/test/fixtures'
import { createEmptyAppData } from '@capacitylens/shared/types/entities'
import type { Company, AppData, ID } from '@capacitylens/shared/types/entities'

function data(): AppData {
  return {
    ...createEmptyAppData(),
    disciplines: [
      {
        ...NULLABLE_FIELDS.disciplines,
        id: 'd2',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        name: 'Dev',
        sortOrder: 1,
      },
      {
        ...NULLABLE_FIELDS.disciplines,
        id: 'd1',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        name: 'Design',
        sortOrder: 0,
      },
    ],
    resources: [
      makeResource({
        id: 'r1',
        companyId: DEFAULT_COMPANY_ID,
        name: 'A',
        jobTitle: 'x',
        disciplineId: 'd1',
        color: '#1',
      }),
      makeResource({
        id: 'r2',
        companyId: DEFAULT_COMPANY_ID,
        name: 'B',
        jobTitle: 'x',
        disciplineId: 'd2',
        color: '#2',
      }),
      makeResource({
        id: 'r3',
        companyId: DEFAULT_COMPANY_ID,
        name: 'C',
        jobTitle: 'x',
        color: '#3',
      }),
    ],
    projects: [
      {
        ...NULLABLE_FIELDS.projects,
        id: 'p1',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        name: 'P',
        clientId: 'c1',
        color: '#1',
      },
    ],
    activities: [
      {
        ...NULLABLE_FIELDS.activities,
        id: 't1',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        name: 'T1',
        kind: 'project',
        projectId: 'p1',
      },
      {
        ...NULLABLE_FIELDS.activities,
        id: 't2',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        name: 'T2',
        kind: 'project',
        projectId: 'p2',
      },
    ],
  }
}

describe('resourcesByDiscipline', () => {
  it('groups resources under disciplines ordered by sortOrder, with an ungrouped bucket last', () => {
    const groups = buildDisciplineGroups(data())
    expect(groups.map((g) => g.discipline?.name ?? '(none)')).toEqual(['Design', 'Dev', '(none)'])
    expect(groups[0]?.resources.map((r) => r.id)).toEqual(['r1'])
    const ungrouped = groups[2]
    if (!ungrouped) throw new Error('Expected ungrouped resources')
    expect(ungrouped.discipline).toBeNull()
    expect(groups[2]?.resources.map((r) => r.id)).toEqual(['r3'])
  })
})

type CompaniesOptions = { disciplinesEnabled?: boolean | undefined }
describe('disciplinesEnabledFor', () => {
  const companies = ({ disciplinesEnabled }: CompaniesOptions) => ({
    ...createEmptyAppData(),
    companies: [
      makeCompany({
        id: 'a1',
        createdAt: 't',
        updatedAt: 't',
        name: 'Studio',
        color: '#1',
        disciplinesEnabled: disciplinesEnabled ?? null,
      }),
    ],
  })

  it('defaults to true when the field is null', () => {
    expect(hasDisciplinesEnabled(companies({ disciplinesEnabled: undefined }), 'a1')).toBe(true)
  })

  it('defaults to true when no company matches', () => {
    expect(hasDisciplinesEnabled(companies({ disciplinesEnabled: false }), 'missing')).toBe(true)
  })

  it('returns the explicit company value', () => {
    expect(hasDisciplinesEnabled(companies({ disciplinesEnabled: false }), 'a1')).toBe(false)
    expect(hasDisciplinesEnabled(companies({ disciplinesEnabled: true }), 'a1')).toBe(true)
  })
})

const companyData = (values: Partial<Company> = {}): AppData => ({
  ...createEmptyAppData(),
  companies: [
    makeCompany({
      id: 'a1',
      createdAt: 't',
      updatedAt: 't',
      name: 'Studio',
      color: '#1',
      ...values,
    }),
  ],
})

const companyFeatureCases: Array<{
  name: string
  selector: (data: AppData, companyId: ID | null) => unknown
  fallback: unknown
  explicit: unknown[]
  values: (value: unknown) => Partial<Company>
}> = [
  {
    name: 'scheduling mode',
    selector: resolveSchedulingMode,
    fallback: 'hourly',
    explicit: ['days', 'blocks'],
    values: (schedulingMode) =>
      schedulingMode === undefined
        ? {}
        : { schedulingMode: schedulingMode as NonNullable<Company['schedulingMode']> },
  },
  {
    name: 'placeholders',
    selector: hasPlaceholdersEnabled,
    fallback: false,
    explicit: [true, false],
    values: (placeholdersEnabled) => ({ placeholdersEnabled: placeholdersEnabled as boolean }),
  },
  {
    name: 'external resources',
    selector: hasExternalResourcesEnabled,
    fallback: false,
    explicit: [true, false],
    values: (externalEnabled) => ({ externalEnabled: externalEnabled as boolean }),
  },
  {
    name: 'inline activity creation',
    selector: canCreateInlineActivity,
    fallback: false,
    explicit: [true, false],
    values: (inlineActivityCreateEnabled) => ({
      inlineActivityCreateEnabled: inlineActivityCreateEnabled as boolean,
    }),
  },
]

describe('company feature selector defaults', () => {
  it.each(companyFeatureCases)(
    'pins absent, unmatched and explicit $name values',
    ({ selector, fallback, explicit, values }) => {
      expect(selector(companyData(), 'a1')).toBe(fallback)
      expect(selector(companyData(values(explicit[0])), 'missing')).toBe(fallback)
      for (const value of explicit) expect(selector(companyData(values(value)), 'a1')).toBe(value)
    }
  )
})

describe('calendar primitive selectors', () => {
  const companies = (
    calendar?: Pick<Partial<Company>, 'timezone' | 'weekStartsOn' | 'workingDays'>
  ) => ({
    ...createEmptyAppData(),
    companies: [
      makeCompany({
        id: 'a1',
        createdAt: 't',
        updatedAt: 't',
        name: 'Studio',
        color: '#1',
        timezone: calendar?.timezone ?? null,
        weekStartsOn: calendar?.weekStartsOn ?? null,
        workingDays: calendar?.workingDays ?? null,
      }),
    ],
  })

  it('single-sources absent calendar defaults without returning a fresh object', () => {
    expect(resolveTimeZone(companies(), 'missing')).toBe('Etc/GMT')
    expect(resolveWeekStart(companies(), 'missing')).toBe(1)
  })

  it('returns the active company calendar values', () => {
    const appData = companies({ timezone: 'Europe/London', weekStartsOn: 0 })
    expect(resolveTimeZone(appData, 'a1')).toBe('Europe/London')
    expect(resolveWeekStart(appData, 'a1')).toBe(0)
  })

  it('derives legacy company working days from week start and preserves an explicit selection', () => {
    expect(listCompanyWorkingDays(companies({ weekStartsOn: 1 }), 'a1')).toEqual([1, 2, 3, 4, 5])
    expect(listCompanyWorkingDays(companies({ weekStartsOn: 0 }), 'a1')).toEqual([0, 1, 2, 3, 4])
    const sundayCompany = companies({ weekStartsOn: 0 }).companies[0]
    if (!sundayCompany) throw new Error('Expected Sunday-start company fixture')
    expect(
      listCompanyWorkingDays(
        {
          ...NULLABLE_FIELDS.companies,
          ...companies({ weekStartsOn: 0 }),
          companies: [{ ...sundayCompany, workingDays: [1, 3, 5] }],
        },
        'a1'
      )
    ).toEqual([1, 3, 5])
  })

  it('repairs an empty persisted company week from its configured week start', () => {
    expect(listCompanyWorkingDays(companies({ weekStartsOn: 1, workingDays: [] }), 'a1')).toEqual([
      1, 2, 3, 4, 5,
    ])
    expect(listCompanyWorkingDays(companies({ weekStartsOn: 0, workingDays: [] }), 'a1')).toEqual([
      0, 1, 2, 3, 4,
    ])
  })
})

describe('hasResourceEngagementGrouping', () => {
  const resources = (...rows: Parameters<typeof makeResource>[0][]): AppData => ({
    ...createEmptyAppData(),
    resources: rows.map((row, index) => makeResource({ id: `r${index}`, companyId: 'a1', ...row })),
  })

  it('keeps a Studio-only company flat', () => {
    expect(hasResourceEngagementGrouping(resources({}, {}), 'a1')).toBe(false)
  })

  it('splits the company once one active Supplementary person exists', () => {
    expect(
      hasResourceEngagementGrouping(resources({}, { engagement: 'supplementary' }), 'a1')
    ).toBe(true)
  })

  it("ignores archived, external and other companies' Supplementary resources", () => {
    expect(
      hasResourceEngagementGrouping(
        resources({ engagement: 'supplementary', archivedAt: 't' }),
        'a1'
      )
    ).toBe(false)
    expect(
      hasResourceEngagementGrouping(
        resources({ engagement: 'supplementary', kind: 'external' }),
        'a1'
      )
    ).toBe(false)
    expect(hasResourceEngagementGrouping(resources({ engagement: 'supplementary' }), 'a2')).toBe(
      false
    )
  })
})

describe('hasVisibleTaskFieldInSchedule', () => {
  it('defaults off and remains company-scoped', () => {
    const appData = {
      ...createEmptyAppData(),
      companies: [
        { ...makeCompany({ id: 'a1' }), showTaskFieldInSchedule: true },
        { ...makeCompany({ id: 'a2' }), showTaskFieldInSchedule: false },
      ],
    }
    expect(hasVisibleTaskFieldInSchedule(appData, 'a1')).toBe(true)
    expect(hasVisibleTaskFieldInSchedule(appData, 'a2')).toBe(false)
    expect(hasVisibleTaskFieldInSchedule({ ...appData, companies: [] }, 'a1')).toBe(false)
  })
})

describe('visibleRange', () => {
  it('spans rangeDays inclusive from the origin', () => {
    const range = buildVisibleRange({
      zoom: 4,
      originDate: '2026-06-01',
      rangeDays: 7,
      focusDate: '2026-06-01',
      drawMode: 'work',
      selectedAllocationId: null,
      filters: buildEmptyFilters(),
      collapsedGroups: [],
      recenterToken: 0,
      scrollToResource: null,
    })
    expect(range).toEqual({ start: '2026-06-01', end: '2026-06-07' })
  })
})

describe('resolveDateStyle', () => {
  const withStyle = (dateStyle?: string): AppData => {
    // Built by assignment rather than a conditional spread: under exactOptionalPropertyTypes a
    // spread of `{ dateStyle } | {}` widens to `dateStyle?: DateStyle | undefined`, which the
    // optional-but-never-undefined property on Company rejects.
    const company: Company = {
      ...NULLABLE_FIELDS.companies,
      id: 'a1',
      createdAt: 't',
      updatedAt: 't',
      name: 'Studio',
      color: '#1',
    }
    if (dateStyle) company.dateStyle = dateStyle as NonNullable<Company['dateStyle']>
    return { ...createEmptyAppData(), companies: [company] }
  }

  it('defaults absent and unmatched companies to day-month', () => {
    expect(resolveDateStyle(withStyle(), 'a1')).toBe('day-month')
    expect(resolveDateStyle(withStyle('month-day'), 'missing')).toBe('day-month')
  })

  it('returns an explicit choice', () => {
    expect(resolveDateStyle(withStyle('month-day-ordinal'), 'a1')).toBe('month-day-ordinal')
  })

  it('reads a style this build has no descriptor for as the default', () => {
    // `companies.dateStyle` is plain nullable TEXT with no CHECK constraint, and the style is a
    // lookup key in every formatter. A database from a build that shipped another style, or a
    // hand-edited row, would otherwise take every date on screen down with it.
    expect(resolveDateStyle(withStyle('year-month-day'), 'a1')).toBe('day-month')
  })
})

it('orders equal-name equal-order scheduler disciplines by stable id regardless of storage order', () => {
  const initial = data()
  const first = initial.disciplines[0]
  if (!first) throw new Error('Expected discipline fixture')
  const equal = [
    { ...first, id: 'd-z', name: 'Design', sortOrder: 1 },
    { ...first, id: 'd-a', name: 'Design', sortOrder: 1 },
  ]
  for (const disciplines of [equal, equal.toReversed()]) {
    expect(
      buildDisciplineGroups({ ...initial, disciplines })
        .filter((group) => group.discipline)
        .map((group) => group.discipline?.id)
    ).toEqual(['d-a', 'd-z'])
    expect(initial.disciplines).toEqual(data().disciplines)
  }
})
