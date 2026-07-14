import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'
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
    // Exclude the guaranteed built-in Internal client; the two imported clients each get a fresh id.
    const ids = s().data.clients.filter((c) => c.accountId === DEFAULT_ACCOUNT_ID && !c.builtin).map((c) => c.id)
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
      activities: [{ id: 't1', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'T', projectId: 'p1' }],
      resources: [{ id: 'r1', accountId: 'X', createdAt: 't', updatedAt: 't', kind: 'person', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#333333' }],
      allocations: [
        { id: 'ok', accountId: 'X', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
        { id: 'bad', accountId: 'X', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 'missing', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      ],
    } as unknown as AppData
    const summary = s().importData(incoming)
    // 4 entities + 1 valid allocation kept; 1 allocation dropped.
    expect(summary.imported).toBe(5)
    expect(summary.skipped).toBe(1)
  })

  it('does not pollute Object.prototype via a crafted __proto__ payload', () => {
    const incoming = JSON.parse(
      '{"accounts":[],"disciplines":[],"clients":[{"id":"c","accountId":"X","createdAt":"t","updatedAt":"t","name":"P","color":"#111111","__proto__":{"polluted":true}}],"projects":[],"phases":[],"activities":[],"resources":[],"allocations":[],"timeOff":[]}',
    ) as AppData
    s().importData(incoming)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  it('does not create a second builtin Internal client on import; re-points an Internal-owned project at the existing one', () => {
    // The active account already has its builtin Internal client.
    s().replaceAll({
      ...emptyAppData(),
      accounts: [{ id: DEFAULT_ACCOUNT_ID, createdAt: 't', updatedAt: 't', name: 'Test Co', color: '#111111' }],
      clients: [{ id: 'existing-internal', accountId: DEFAULT_ACCOUNT_ID, createdAt: 't', updatedAt: 't', name: 'Internal', color: '#9c3ace', builtin: true }],
    })
    s().setActiveAccount(DEFAULT_ACCOUNT_ID)
    // An imported file carrying its OWN builtin Internal client + a project owned by it.
    const incoming = {
      ...emptyAppData(),
      clients: [{ id: 'src-internal', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'Internal', color: '#9c3ace', builtin: true }],
      projects: [{ id: 'src-p', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'Internal Project', clientId: 'src-internal', color: '#222222' }],
    } as unknown as AppData
    s().importData(incoming)
    // Import REPLACES the account slice, so exactly ONE builtin remains (the imported one, kept as
    // the account's Internal) — never two. Its name stays the reserved "Internal".
    const builtins = s().data.clients.filter((c) => c.builtin && c.accountId === DEFAULT_ACCOUNT_ID)
    expect(builtins).toHaveLength(1)
    expect(builtins[0].name).toBe('Internal')
    // The imported Internal-owned project survived and points at that single Internal client.
    const proj = s().data.projects.find((p) => p.name === 'Internal Project')
    expect(proj).toBeTruthy()
    expect(proj!.clientId).toBe(builtins[0].id)
  })

  it('refuses a zero-record import rather than wiping the active account', () => {
    s().addClient({ name: 'Keep me', color: '#123456' })
    const before = s().data.clients.filter((c) => c.accountId === DEFAULT_ACCOUNT_ID).length
    expect(before).toBeGreaterThan(0)
    // An empty (or all-dropped) dataset would otherwise replace the slice with nothing.
    const summary = s().importData(emptyAppData())
    expect(summary.imported).toBe(0)
    expect(s().data.clients.filter((c) => c.accountId === DEFAULT_ACCOUNT_ID)).toHaveLength(before)
  })
})
