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
      { id: 'd-design', createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 },
      { id: 'd-dev', createdAt: 't', updatedAt: 't', name: 'Development', sortOrder: 1 },
    ],
    clients: [{ id: 'c1', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#1' }],
    projects: [
      { id: 'p1', createdAt: 't', updatedAt: 't', name: 'P1', clientId: 'c1', color: '#2' },
      { id: 'p2', createdAt: 't', updatedAt: 't', name: 'P2', clientId: 'c1', color: '#3' },
    ],
    tasks: [
      { id: 't1', createdAt: 't', updatedAt: 't', name: 'T1', projectId: 'p1' },
      { id: 't2', createdAt: 't', updatedAt: 't', name: 'T2', projectId: 'p2' },
    ],
    resources: [
      { id: 'r1', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Designer Dana', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#4' },
      { id: 'r2', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Dev Sam', role: 'Developer', disciplineId: 'd-dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#5' },
    ],
    allocations: [
      { id: 'a1', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a2', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't2', startDate: '2026-06-03', endDate: '2026-06-04', hoursPerDay: 4, status: 'tentative' },
      { id: 'a3', createdAt: 't', updatedAt: 't', resourceId: 'r2', taskId: 't2', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
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

  it('project filter limits bars to that project (resources still listed)', () => {
    expect(barIds(build({ ...emptyFilters(), projectId: 'p2' }))).toEqual(['a2', 'a3'])
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
