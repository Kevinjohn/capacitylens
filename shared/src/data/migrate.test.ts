import { describe, it, expect } from 'vitest'
import { migrate, UnsupportedSchemaVersionError } from './migrate'
import { emptyAppData, EXPORT_SCHEMA_VERSION } from '../types/entities'

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

  it('refuses a forward schema instead of normalizing and later overwriting it', () => {
    expect(() =>
      migrate({ schemaVersion: EXPORT_SCHEMA_VERSION + 1, data: { ...emptyAppData(), futureTable: [{ id: 'future' }] } }),
    ).toThrow(UnsupportedSchemaVersionError)
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

  it('leaves a v7 account without internalColourMode absent so it reads as grey', () => {
    const data = {
      ...emptyAppData(),
      accounts: [{ id: 'a1', createdAt: 't', updatedAt: 't', name: 'Studio', color: '#2d75da' }],
    }
    const out = migrate({ schemaVersion: 7, data })
    expect(out.accounts[0].internalColourMode).toBeUndefined()
  })

  it('leaves a v8 account without the schedule view prefs absent so they read as shown/enabled (v8 → v9)', () => {
    // v8→v9 is a metadata-only step (like v7→v8): the three new optional booleans stay ABSENT so the
    // client's `?? true` reads them as shown/enabled — the migration materialises no defaults.
    const data = {
      ...emptyAppData(),
      accounts: [{ id: 'a1', createdAt: 't', updatedAt: 't', name: 'Studio', color: '#2d75da' }],
    }
    const out = migrate({ schemaVersion: 8, data })
    expect(out.accounts[0].showInternalProjects).toBeUndefined()
    expect(out.accounts[0].showInternalActivities).toBeUndefined()
    expect(out.accounts[0].inlineActivityCreateEnabled).toBeUndefined()
  })

  it('preserves explicit false schedule view prefs across migration (v8 → v9)', () => {
    const data = {
      ...emptyAppData(),
      accounts: [{ id: 'a1', createdAt: 't', updatedAt: 't', name: 'Studio', color: '#2d75da', showInternalProjects: false, showInternalActivities: false, inlineActivityCreateEnabled: false }],
    }
    const out = migrate({ schemaVersion: 8, data })
    expect(out.accounts[0].showInternalProjects).toBe(false)
    expect(out.accounts[0].showInternalActivities).toBe(false)
    expect(out.accounts[0].inlineActivityCreateEnabled).toBe(false)
  })

  it('backfills activity kind on a pre-v4 payload (v3 → v4): project-bound → project, project-less → repeatable', () => {
    // Legacy input still carries the OLD `tasks` key (pre-rename); migrate renames it to
    // `activities` (v4→v5) so the OUTPUT is asserted on `out.activities`.
    const out = migrate({
      schemaVersion: 3,
      data: {
        tasks: [
          { id: 't1', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Wires', projectId: 'p1' },
          { id: 't2', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Admin' },
        ],
      },
    })
    expect(out.activities[0]).toMatchObject({ id: 't1', kind: 'project' })
    expect(out.activities[1]).toMatchObject({ id: 't2', kind: 'repeatable' })
  })

  it('preserves an already-set activity kind when backfilling (the v3→v4 guard is idempotent)', () => {
    const out = migrate({
      schemaVersion: 3,
      data: {
        tasks: [{ id: 't1', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Admin', kind: 'internal' }],
      },
    })
    expect(out.activities[0]).toMatchObject({ kind: 'internal' })
  })

  it('renames the legacy `tasks` table → `activities` and `taskId` → `activityId` (v4 → v5)', () => {
    const out = migrate({
      schemaVersion: 4,
      data: {
        tasks: [{ id: 't1', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Wires', kind: 'project', projectId: 'p1' }],
        allocations: [
          { id: 'al1', accountId: 'a1', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't1', startDate: '2026-01-01', endDate: '2026-01-02', hoursPerDay: 8, status: 'confirmed' },
        ],
      },
    })
    // The renamed table arrives as `activities`; the old key is gone.
    expect(out.activities).toHaveLength(1)
    expect(out.activities[0]).toMatchObject({ id: 't1', kind: 'project' })
    expect('tasks' in out).toBe(false)
    // The allocation's FK is renamed; no `taskId` survives.
    expect(out.allocations[0]).toMatchObject({ activityId: 't1' })
    expect('taskId' in out.allocations[0]).toBe(false)
  })

  it('treats a bare (versionless) legacy `tasks` blob as pre-v5 and renames it', () => {
    const out = migrate({
      tasks: [{ id: 't1', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Admin', kind: 'internal' }],
    })
    expect(out.activities).toHaveLength(1)
    expect('tasks' in out).toBe(false)
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
      activities: [],
      allocations: [],
      timeOff: [],
    })
    expect(out.clients).toHaveLength(1)
  })
})
