import { describe, it, expect } from 'vitest'
import { buildSchedulerModel, type GroupModel } from './schedulerModel'
import { eachDayISO } from '../../lib/dateMath'
import { emptyFilters } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'
import type { AppData } from '../../types/entities'

const start = '2026-06-01'
const end = '2026-06-07'
const days = eachDayISO(start, end)

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
    tasks: [
      { id: 't1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T1', projectId: 'p1' },
      { id: 't2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T2', projectId: 'p2' },
    ],
    resources: [
      { id: 'r1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Designer Dana', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#4' },
      { id: 'r2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Dev Sam', role: 'Developer', disciplineId: 'd-dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#5' },
    ],
    allocations: [
      { id: 'a1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't2', startDate: '2026-06-03', endDate: '2026-06-04', hoursPerDay: 4, status: 'tentative' },
      { id: 'a3', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r2', taskId: 't2', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
    ],
    timeOff: [],
  }
}

const build = (filters = emptyFilters()) => buildSchedulerModel(dataset(), start, 48, days, start, end, filters)
const allBars = (model: GroupModel[]) => model.flatMap((g) => g.rows).flatMap((r) => r.bars)
const barIds = (model: GroupModel[]) => allBars(model).map((b) => b.allocation.id).sort()

describe('buildSchedulerModel', () => {
  it('groups by discipline and positions bars (no filters)', () => {
    const model = build()
    expect(model.map((g) => g.title)).toEqual(['Design', 'Development'])
    expect(barIds(model)).toEqual(['a1', 'a2', 'a3'])
    const a1 = allBars(model).find((b) => b.allocation.id === 'a1')!
    expect(a1.x).toBe(0) // origin === start
    expect(a1.width).toBe(96) // 2 inclusive days * 48
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
    const model = buildSchedulerModel(dataset(), start, 48, days, '2026-06-03', '2026-06-04', emptyFilters())
    const r1 = model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1')!
    expect(r1.utilization).toBeCloseTo(0.5)
    // The visible model (bars/day-states) still covers the full `days` range.
    expect(r1.dayStates.length).toBe(days.length)
  })

  it('flags overSoon when a resource is over-allocated on a day in the utilisation window', () => {
    const d = dataset()
    // Stack a second 8h allocation on r1's 6/1–6/2 (8 + 8 > 8 available -> over).
    d.allocations.push({ id: 'a4', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const rows = buildSchedulerModel(d, start, 48, days, start, end, emptyFilters()).flatMap((g) => g.rows)
    expect(rows.find((r) => r.resource.id === 'r1')!.overSoon).toBe(true)
    expect(rows.find((r) => r.resource.id === 'r2')!.overSoon).toBe(false) // 8h == 8h available, not over
  })

  it('project filter limits bars to that project (resources still listed)', () => {
    expect(barIds(build({ ...emptyFilters(), projectId: 'p2' }))).toEqual(['a2', 'a3'])
  })

  it('dims (not hides) a resource with no work on the active project, showing its real load', () => {
    // r1 works on p1; r2 has only p2 work → r2 is dimmed but still shown (its a3 bar)
    // so you can see it's available to staff onto p1.
    const rows = build({ ...emptyFilters(), projectId: 'p1' }).flatMap((g) => g.rows)
    expect(rows.find((r) => r.resource.id === 'r1')!.dimmed).toBe(false)
    const r2 = rows.find((r) => r.resource.id === 'r2')!
    expect(r2.dimmed).toBe(true)
    expect(r2.bars.map((b) => b.allocation.id)).toEqual(['a3'])
  })

  it('hides the dimmed (unallocated) rows when showUnmatched is off', () => {
    const rows = build({ ...emptyFilters(), projectId: 'p1', showUnmatched: false }).flatMap((g) => g.rows)
    expect(rows.map((r) => r.resource.id)).toEqual(['r1'])
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
})
