import { beforeEach, describe, expect, it } from 'vitest'
import { diffOps } from '../data/syncOps'
import { useStore } from './useStore'
import { DEFAULT_ACCOUNT_ID, makeAppData, resetStoreWithAccount } from '../test/fixtures'
import type { AppData } from '@capacitylens/shared/types/entities'

const T = '2026-01-01T00:00:00.000Z'
const OLD = '2020-01-01T00:00:00.000Z'
const meta = { accountId: DEFAULT_ACCOUNT_ID, createdAt: T, updatedAt: T }

beforeEach(() => resetStoreWithAccount())

function undoOps(afterDelete: AppData) {
  useStore.getState().undo()
  return diffOps(afterDelete, useStore.getState().data)
}

describe('undo emits synchronization revisions for cascade-restored bindings', () => {
  it('restores an activity phaseId with an activity PUT', () => {
    useStore.getState().replaceAll(makeAppData({
      clients: [{ ...meta, id: 'c1', name: 'Client', color: '#111111' }],
      projects: [{ ...meta, id: 'p1', clientId: 'c1', name: 'Project', color: '#222222' }],
      phases: [{ ...meta, id: 'ph1', projectId: 'p1', name: 'Phase' }],
      activities: [{ ...meta, id: 'act1', projectId: 'p1', phaseId: 'ph1', kind: 'project', name: 'Work' }],
    }))
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)

    useStore.getState().deletePhase('ph1')
    const afterDelete = useStore.getState().data
    expect(afterDelete.activities[0].phaseId).toBeUndefined()
    const ops = undoOps(afterDelete)

    expect(ops).toContainEqual(expect.objectContaining({ method: 'PUT', table: 'activities', id: 'act1' }))
    expect(useStore.getState().data.activities[0].phaseId).toBe('ph1')
  })

  it('restores a resource disciplineId with a resource PUT', () => {
    useStore.getState().replaceAll(makeAppData({
      disciplines: [{ ...meta, id: 'd1', name: 'Design', sortOrder: 0 }],
      resources: [{
        ...meta,
        id: 'r1',
        kind: 'person',
        name: 'Person',
        role: 'Designer',
        disciplineId: 'd1',
        employmentType: 'permanent',
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        color: '#333333',
      }],
    }))
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)

    useStore.getState().deleteDiscipline('d1')
    const afterDelete = useStore.getState().data
    expect(afterDelete.resources[0].disciplineId).toBeUndefined()
    const ops = undoOps(afterDelete)

    expect(ops).toContainEqual(expect.objectContaining({ method: 'PUT', table: 'resources', id: 'r1' }))
    expect(useStore.getState().data.resources[0].disciplineId).toBe('d1')
  })

  it('restores a placeholder projectId after project purge with a resource PUT', () => {
    useStore.getState().replaceAll(makeAppData({
      clients: [{ ...meta, id: 'c1', name: 'Client', color: '#111111' }],
      projects: [{ ...meta, id: 'p1', clientId: 'c1', name: 'Project', color: '#222222', archivedAt: OLD, deletedAt: OLD }],
      resources: [{
        ...meta,
        id: 'placeholder',
        kind: 'placeholder',
        role: 'Designer',
        projectId: 'p1',
        employmentType: 'permanent',
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        color: '#333333',
      }],
    }))
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)

    useStore.getState().purgeEntity('projects', 'p1')
    const afterDelete = useStore.getState().data
    expect(afterDelete.resources[0].projectId).toBeUndefined()
    const ops = undoOps(afterDelete)
    expect(ops).toEqual([])
    expect(useStore.getState().data.resources[0].projectId).toBeUndefined()
  })

  it('restores a placeholder projectId after client purge with a resource PUT', () => {
    useStore.getState().replaceAll(makeAppData({
      clients: [{ ...meta, id: 'c1', name: 'Client', color: '#111111', archivedAt: OLD, deletedAt: OLD }],
      projects: [{ ...meta, id: 'p1', clientId: 'c1', name: 'Project', color: '#222222' }],
      resources: [{
        ...meta,
        id: 'placeholder',
        kind: 'placeholder',
        role: 'Designer',
        projectId: 'p1',
        employmentType: 'permanent',
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        color: '#333333',
      }],
    }))
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)

    useStore.getState().purgeEntity('clients', 'c1')
    const afterDelete = useStore.getState().data
    expect(afterDelete.resources[0].projectId).toBeUndefined()
    const ops = undoOps(afterDelete)
    expect(ops).toEqual([])
    expect(useStore.getState().data.resources[0].projectId).toBeUndefined()
  })
})
