import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from '../test/fixtures'

const s = () => useStore.getState()

beforeEach(() => {
  resetStoreWithAccount(DEFAULT_ACCOUNT_ID)
})

describe('importData hardening', () => {
  it('gives every id-less record its own fresh id (no collision on undefined)', () => {
    // Two records with NO id must not collapse onto a single shared id.
    const incoming = {
      ...emptyAppData(),
      clients: [
        { accountId: 'X', createdAt: 't', updatedAt: 't', name: 'One', color: '#111111' },
        { accountId: 'X', createdAt: 't', updatedAt: 't', name: 'Two', color: '#222222' },
      ],
    } as unknown as AppData
    s().importData(incoming)
    const ids = s().data.clients.filter((c) => c.accountId === DEFAULT_ACCOUNT_ID).map((c) => c.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2) // distinct
  })

  it('sanitizes value-level fields that bypass the form validators', () => {
    const incoming = {
      ...emptyAppData(),
      resources: [
        { id: 'r1', accountId: 'X', createdAt: 't', updatedAt: 't', kind: 'alien', role: 'Dev', employmentType: 'nonsense', workingHoursPerDay: -3, workingDays: [], color: 'notacolor' },
      ],
    } as unknown as AppData
    s().importData(incoming)
    const r = s().data.resources.find((x) => x.accountId === DEFAULT_ACCOUNT_ID)!
    expect(r.kind).toBe('person')
    expect(r.employmentType).toBe('permanent')
    expect(r.workingHoursPerDay).toBe(8)
    expect(r.color).toBe('#6366f1')
  })

  it('returns a delta summary counting records kept vs. dropped as invalid', () => {
    const incoming = {
      ...emptyAppData(),
      clients: [{ id: 'c1', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'C', color: '#111111' }],
      projects: [{ id: 'p1', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'P', clientId: 'c1', color: '#222222' }],
      tasks: [{ id: 't1', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'T', projectId: 'p1' }],
      resources: [{ id: 'r1', accountId: 'X', createdAt: 't', updatedAt: 't', kind: 'person', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#333333' }],
      allocations: [
        { id: 'ok', accountId: 'X', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
        { id: 'bad', accountId: 'X', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 'missing', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      ],
    } as unknown as AppData
    const summary = s().importData(incoming)
    // 4 entities + 1 valid allocation kept; 1 allocation dropped.
    expect(summary.imported).toBe(5)
    expect(summary.skipped).toBe(1)
  })

  it('does not pollute Object.prototype via a crafted __proto__ payload', () => {
    const incoming = JSON.parse(
      '{"accounts":[],"disciplines":[],"clients":[{"id":"c","accountId":"X","createdAt":"t","updatedAt":"t","name":"P","color":"#111111","__proto__":{"polluted":true}}],"projects":[],"phases":[],"tasks":[],"resources":[],"allocations":[],"timeOff":[]}',
    ) as AppData
    s().importData(incoming)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
  })
})
