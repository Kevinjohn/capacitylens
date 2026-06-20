import { describe, it, expect } from 'vitest'
import { migrate } from './migrate'
import { emptyAppData } from '../types/entities'

describe('migrate', () => {
  it('returns empty data for null/garbage', () => {
    expect(migrate(null)).toEqual(emptyAppData())
    expect(migrate('nope')).toEqual(emptyAppData())
    expect(migrate(42)).toEqual(emptyAppData())
    expect(migrate(undefined)).toEqual(emptyAppData())
  })

  it('unwraps a { schemaVersion, data } wrapper', () => {
    const data = {
      ...emptyAppData(),
      clients: [{ id: 'c1', createdAt: 't', updatedAt: 't', name: 'A', color: '#1' }],
    }
    expect(migrate({ schemaVersion: 1, data })).toEqual(data)
  })

  it('accepts a bare AppData (legacy, no wrapper)', () => {
    const data = {
      ...emptyAppData(),
      resources: [
        { id: 'r1', createdAt: 't', updatedAt: 't', kind: 'person', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#1' },
      ],
    }
    expect(migrate(data)).toEqual(data)
  })

  it('migrates legacy isFreelancer resources to employmentType (v1 → v2)', () => {
    const legacy = {
      schemaVersion: 1,
      data: {
        resources: [
          { id: 'r1', createdAt: 't', updatedAt: 't', kind: 'person', role: 'Dev', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#1', isFreelancer: true },
        ],
      },
    }
    const out = migrate(legacy)
    expect(out.resources[0]).toMatchObject({ employmentType: 'freelancer' })
    expect('isFreelancer' in out.resources[0]).toBe(false)
  })

  it('treats a missing version as legacy and still migrates', () => {
    const out = migrate({
      resources: [
        { id: 'r1', createdAt: 't', updatedAt: 't', kind: 'person', role: 'Dev', workingHoursPerDay: 8, workingDays: [1], color: '#1', isFreelancer: false },
      ],
    })
    expect(out.resources[0]).toMatchObject({ employmentType: 'permanent' })
  })

  it('leaves a v2 payload untouched (no v2→v3 transform needed)', () => {
    const data = {
      ...emptyAppData(),
      resources: [
        { id: 'r1', createdAt: 't', updatedAt: 't', kind: 'person', role: 'Dev', employmentType: 'contractor', workingHoursPerDay: 8, workingDays: [1], color: '#1' },
      ],
    }
    expect(migrate({ schemaVersion: 2, data })).toEqual(data)
  })

  it('backfills task kind on a pre-v4 payload (v3 → v4): project-bound → project, project-less → repeatable', () => {
    const out = migrate({
      schemaVersion: 3,
      data: {
        tasks: [
          { id: 't1', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Wires', projectId: 'p1' },
          { id: 't2', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Admin' },
        ],
      },
    })
    expect(out.tasks[0]).toMatchObject({ id: 't1', kind: 'project' })
    expect(out.tasks[1]).toMatchObject({ id: 't2', kind: 'repeatable' })
  })

  it('preserves an already-set task kind when backfilling (the v3→v4 guard is idempotent)', () => {
    const out = migrate({
      schemaVersion: 3,
      data: {
        tasks: [{ id: 't1', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Admin', kind: 'internal' }],
      },
    })
    expect(out.tasks[0]).toMatchObject({ kind: 'internal' })
  })

  it('fills in any missing arrays so the shape is always complete', () => {
    const out = migrate({
      schemaVersion: 1,
      data: { clients: [{ id: 'c1', createdAt: 't', updatedAt: 't', name: 'A', color: '#1' }] },
    })
    expect(out).toMatchObject({
      disciplines: [],
      resources: [],
      projects: [],
      phases: [],
      tasks: [],
      allocations: [],
      timeOff: [],
    })
    expect(out.clients).toHaveLength(1)
  })
})
