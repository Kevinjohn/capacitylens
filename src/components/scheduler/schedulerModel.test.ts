import { describe, it, expect } from 'vitest'
import { buildSchedulerModel, type GroupModel } from './schedulerModel'
import { buildColumnGeometry } from './columnGeometry'
import { eachDayISO } from '@floaty/shared/lib/dateMath'
import { emptyFilters } from '../../store/useStore'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'

const start = '2026-06-01'
const end = '2026-06-07'
const days = eachDayISO(start, end)
// Uniform geometry (minimise off) — the bar x/width values below match the legacy
// index*dayWidth grid exactly. The narrow-weekend variant is covered in columnGeometry.test.ts.
const geom = buildColumnGeometry(days, 48, { minimiseWeekends: false, weekendWidth: 22 })

function dataset(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [
      { id: 'd-design', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 },
      { id: 'd-dev', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Development', sortOrder: 1 },
    ],
    clients: [{ id: 'c1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#1' }],
    projects: [
      { id: 'p1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'P1', clientId: 'c1', color: '#2' },
      { id: 'p2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'P2', clientId: 'c1', color: '#3' },
    ],
    activities: [
      { id: 't1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T1', kind: 'project', projectId: 'p1' },
      { id: 't2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T2', kind: 'project', projectId: 'p2' },
    ],
    resources: [
      { id: 'r1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Designer Dana', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#4' },
      { id: 'r2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Dev Sam', role: 'Developer', disciplineId: 'd-dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#5' },
    ],
    allocations: [
      { id: 'a1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't2', startDate: '2026-06-03', endDate: '2026-06-04', hoursPerDay: 4, status: 'tentative' },
      { id: 'a3', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r2', activityId: 't2', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
    ],
    timeOff: [],
  }
}

const build = (filters = emptyFilters(), disciplinesEnabled = true) =>
  buildSchedulerModel(dataset(), geom, days, start, end, filters, disciplinesEnabled)
const allBars = (model: GroupModel[]) => model.flatMap((g) => g.rows).flatMap((r) => r.bars)
const barIds = (model: GroupModel[]) => allBars(model).map((b) => b.allocation.id).sort()

// dataset() + one external party booked on a project activity over a weekend (zero-capacity for a
// person), plus a stray time-off row — to prove externals carry NO capacity signals at all.
function withExternal(): AppData {
  const d = dataset()
  d.resources.push({ id: 'ext1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'external', name: 'Dog Eat Cog', role: 'Partner studio', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#9ca3af' })
  // 6/05 Fri–6/07 Sun: spans 2 zero-capacity days that WOULD flag over for a person. hoursPerDay 0.
  d.allocations.push({ id: 'aext', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'ext1', activityId: 't1', startDate: '2026-06-05', endDate: '2026-06-07', hoursPerDay: 0, status: 'confirmed' })
  d.timeOff.push({ id: 'toext', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'ext1', startDate: '2026-06-02', endDate: '2026-06-03', type: 'holiday' })
  return d
}

describe('buildSchedulerModel', () => {
  it('groups by discipline and positions bars (no filters)', () => {
    const model = build()
    expect(model.map((g) => g.title)).toEqual(['Design', 'Development'])
    expect(barIds(model)).toEqual(['a1', 'a2', 'a3'])
    const a1 = allBars(model).find((b) => b.allocation.id === 'a1')!
    expect(a1.x).toBe(0) // origin === start
    expect(a1.width).toBe(96) // 2 inclusive days * 48
  })

  it('orders people before placeholders within a discipline (regardless of data order)', () => {
    const d = dataset()
    // A placeholder listed BEFORE a person in the same discipline — the model must
    // still surface the person first.
    d.resources = [
      { id: 'ph', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'placeholder', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#9' },
      ...d.resources, // r1 (person, Design), r2 (person, Dev)
    ]
    const model = buildSchedulerModel(d, geom, days, start, end, emptyFilters(), true)
    const design = model.find((g) => g.title === 'Design')!
    expect(design.rows.map((r) => r.resource.id)).toEqual(['r1', 'ph'])
  })

  it('hideTentative removes tentative bars, but capacity/utilisation still count them', () => {
    const model = build({ ...emptyFilters(), hideTentative: true })
    expect(barIds(model)).toEqual(['a1', 'a3'])
    const r1 = model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1')!
    // a1 (8h×2) + a2 (4h×2, tentative) = 24h over 40 available -> 0.6, unaffected by the filter
    expect(r1.utilization).toBeCloseTo(0.6)
  })

  it('utilisation uses its own window, decoupled from the visible `days` range', () => {
    // `days` spans the full week (6/1–6/7), but the utilisation window is just 6/3–6/4.
    // Over that window r1 has only a2 (4h × 2 working days) / (8h × 2) = 0.5,
    // proving the headline % is no longer averaged across the whole timeline.
    const model = buildSchedulerModel(dataset(), geom, days, '2026-06-03', '2026-06-04', emptyFilters(), true)
    const r1 = model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1')!
    expect(r1.utilization).toBeCloseTo(0.5)
    // The visible model (bars/day-states) still covers the full `days` range.
    expect(r1.dayStates.length).toBe(days.length)
  })

  it('flags overSoon when a resource is over-allocated on a day in the utilisation window', () => {
    const d = dataset()
    // Stack a second 8h allocation on r1's 6/1–6/2 (8 + 8 > 8 available -> over).
    d.allocations.push({ id: 'a4', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const rows = buildSchedulerModel(d, geom, days, start, end, emptyFilters(), true).flatMap((g) => g.rows)
    expect(rows.find((r) => r.resource.id === 'r1')!.overSoon).toBe(true)
    expect(rows.find((r) => r.resource.id === 'r2')!.overSoon).toBe(false) // 8h == 8h available, not over
  })

  it('project filter limits bars to that project (resources still listed)', () => {
    expect(barIds(build({ ...emptyFilters(), projectId: 'p2' }))).toEqual(['a2', 'a3'])
  })

  // dataset() + project-less activities (one internal, one repeatable) with an allocation each, so the
  // activity lens has something to filter. r1 picks up an internal bar, r2 a repeatable one.
  function withLensActivities(): AppData {
    const d = dataset()
    d.activities.push(
      { id: 't-int', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Admin', kind: 'internal' },
      { id: 't-rep', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Design', kind: 'repeatable' },
    )
    d.allocations.push(
      { id: 'a-int', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't-int', startDate: '2026-06-05', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-rep', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r2', activityId: 't-rep', startDate: '2026-06-05', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
    )
    return d
  }
  const buildLens = (filters = emptyFilters()) =>
    buildSchedulerModel(withLensActivities(), geom, days, start, end, filters, true)

  it('activity lens: a specific activity id limits bars to that activity', () => {
    // Default (showUnmatched off): non-matching rows collapse out and matching rows show ONLY
    // their matching bars. (With showUnmatched on, dimmed rows show full real load by design.)
    const bars = buildLens({ ...emptyFilters(), activityId: 't-rep' })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort()
    expect(bars).toEqual(['a-rep'])
  })

  it('activity lens: "Repeatable — All" (activityKind) shows only repeatable-activity allocations', () => {
    const bars = buildLens({ ...emptyFilters(), activityKind: 'repeatable' })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort()
    expect(bars).toEqual(['a-rep'])
  })

  it('activity lens: "Internal — All" (activityKind) shows only internal-activity allocations', () => {
    const bars = buildLens({ ...emptyFilters(), activityKind: 'internal' })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort()
    expect(bars).toEqual(['a-int'])
  })

  it('activity lens: dims (and by default hides) rows with no work on the filtered activity', () => {
    // activityKind 'repeatable' matches only r2's a-rep. By default (showUnmatched off) r1 collapses out.
    const rows = buildLens({ ...emptyFilters(), activityKind: 'repeatable' }).flatMap((g) => g.rows)
    expect(rows.map((r) => r.resource.id)).toEqual(['r2'])
  })

  it('dims (not hides) a resource with no work on the active project when showUnmatched is opted in', () => {
    // r1 works on p1; r2 has only p2 work → with showUnmatched on, r2 is dimmed but
    // still shown (its a3 bar) so you can see it's available to staff onto p1.
    const rows = build({ ...emptyFilters(), projectId: 'p1', showUnmatched: true }).flatMap((g) => g.rows)
    expect(rows.find((r) => r.resource.id === 'r1')!.dimmed).toBe(false)
    const r2 = rows.find((r) => r.resource.id === 'r2')!
    expect(r2.dimmed).toBe(true)
    expect(r2.bars.map((b) => b.allocation.id)).toEqual(['a3'])
  })

  it('hides the unmatched (unallocated) rows by default', () => {
    // emptyFilters() ships showUnmatched: false — filtering collapses to matching rows.
    const rows = build({ ...emptyFilters(), projectId: 'p1' }).flatMap((g) => g.rows)
    expect(rows.map((r) => r.resource.id)).toEqual(['r1'])
  })

  it('does not leave a full-opacity zero-bar ghost row when the only match is a hidden tentative allocation', () => {
    // r1's only p2 work (a2) is tentative; with hideTentative it's hidden, so r1 has no
    // VISIBLE match. It must be treated as unmatched (dimmed) — and filtered out when
    // showUnmatched is off — not rendered as a full-opacity row with zero bars.
    const filters = { ...emptyFilters(), projectId: 'p2', hideTentative: true, showUnmatched: false }
    const rows = build(filters).flatMap((g) => g.rows)
    expect(rows.map((r) => r.resource.id)).toEqual(['r2']) // r1 filtered out, not a ghost
    expect(rows.every((r) => r.dimmed || r.bars.length > 0)).toBe(true) // no non-dimmed zero-bar row
  })

  it('dims (showing real load) a tentative-only-match row when showUnmatched is on', () => {
    const filters = { ...emptyFilters(), projectId: 'p2', hideTentative: true, showUnmatched: true }
    const r1 = build(filters)
      .flatMap((g) => g.rows)
      .find((r) => r.resource.id === 'r1')!
    expect(r1.dimmed).toBe(true) // its only p2 work is hidden → dimmed, not full-opacity
    expect(r1.bars.map((b) => b.allocation.id)).toEqual(['a1']) // shows its real non-tentative load
  })

  it('discipline filter drops other groups', () => {
    const model = build({ ...emptyFilters(), disciplineId: 'd-dev' })
    expect(model.map((g) => g.title)).toEqual(['Development'])
    expect(barIds(model)).toEqual(['a3'])
  })

  it('search narrows to matching resources and drops now-empty groups', () => {
    const model = build({ ...emptyFilters(), search: 'dev sam' })
    expect(model.map((g) => g.title)).toEqual(['Development'])
  })

  it('disciplines off → one flat group holding every resource (no discipline bands)', () => {
    const model = build(emptyFilters(), false)
    expect(model).toHaveLength(1)
    expect(model[0].rows.map((r) => r.resource.id).sort()).toEqual(['r1', 'r2'])
    expect(model[0].color).toBeUndefined() // no discipline colour → avatar falls back to resource colour
    expect(barIds(model)).toEqual(['a1', 'a2', 'a3'])
  })

  it('disciplines off → the discipline filter is ignored (everyone still shown)', () => {
    const model = build({ ...emptyFilters(), disciplineId: 'd-dev' }, false)
    expect(model).toHaveLength(1)
    expect(model[0].rows.map((r) => r.resource.id).sort()).toEqual(['r1', 'r2'])
  })
})

describe('external / 3rd-party band', () => {
  const buildExt = (filters = emptyFilters(), disciplinesEnabled = true) =>
    buildSchedulerModel(withExternal(), geom, days, start, end, filters, disciplinesEnabled)

  it('renders external resources in a neutral band that is ALWAYS last', () => {
    const model = buildExt()
    // Discipline bands first, then the external band — never interleaved.
    expect(model.map((g) => g.key)).toEqual(['d-design', 'd-dev', 'external'])
    const last = model[model.length - 1]
    expect(last.title).toBe('External / 3rd party')
    expect(last.color).toBe('#9ca3af') // NEUTRAL_COLOR
    expect(last.rows.map((r) => r.resource.id)).toEqual(['ext1'])
  })

  it('external rows carry NO capacity: utilisation 0, never overSoon, no day markers, no time-off', () => {
    const ext = buildExt().at(-1)!.rows[0]
    expect(ext.utilization).toBe(0)
    expect(ext.overSoon).toBe(false)
    // Its booking spans a weekend (zero-capacity for a person), yet no day is flagged.
    expect(ext.dayStates.every((d) => !d.over && !d.unavailable)).toBe(true)
    expect(ext.timeOff).toEqual([]) // the stray time-off row is ignored for externals
  })

  it('external parties are still assignable — their activity bars still render', () => {
    const ext = buildExt().at(-1)!.rows[0]
    expect(ext.bars.map((b) => b.allocation.id)).toEqual(['aext'])
  })

  it('disciplines off → external STILL forms its own trailing band (below the flat group)', () => {
    const model = buildExt(emptyFilters(), false)
    expect(model).toHaveLength(2) // flat (our people) + external
    expect(model[0].rows.map((r) => r.resource.id).sort()).toEqual(['r1', 'r2'])
    expect(model[1].key).toBe('external')
    expect(model[1].rows.map((r) => r.resource.id)).toEqual(['ext1'])
  })
})
