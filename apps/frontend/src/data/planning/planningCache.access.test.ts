import { readPlanningError } from './planningNotices'
import { getMasqueradeToken } from '@/api/masqueradeToken'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { makeCompany, makeAppData, makeClient } from '@/test/fixtures'
import { createPlanningCache, createPlanningCacheState } from './planningCache'
import { PlanningCacheError } from './planningErrors'
import type { FullPlanningSnapshot, PlanningTransport } from './planningCacheTypes'
import { emptyCapacity } from '@/test/capacityFixtures'
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures'
import { createDeferred } from '@/test/createDeferred'

type RequestStage = 'read' | 'execute'
type Success = Awaited<ReturnType<PlanningTransport['execute']>>

const context = { identity: 'bruce-session-1', companyId: 'wayne' }
const update = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-21' },
} as const

function snapshot(name: string, revision = 1): FullPlanningSnapshot {
  return {
    revision,
    access: makePlanningAccess(),
    data: makeAppData({
      companies: [makeCompany({ id: 'wayne', name: 'Wayne Enterprises' })],
      clients: [makeClient({ companyId: 'wayne', name })],
    }),
    today: '2026-06-03',
    capacity: emptyCapacity(),
    history: { canUndo: true, canRedo: false },
  }
}

async function setup() {
  const store = createStore(() => createPlanningCacheState())
  const read = vi.fn<PlanningTransport['read']>().mockResolvedValue(snapshot('Wayne Enterprises'))
  const execute = vi.fn<PlanningTransport['execute']>()
  const cache = createPlanningCache({
    readMasqueradeToken: getMasqueradeToken,
    getState: store.getState,
    setState: store.setState,
    transport: { read, execute, undo: vi.fn(), redo: vi.fn() },
  })
  cache.setContext(context)
  await cache.refresh()
  return { store, cache, read, execute }
}

type Fixture = Awaited<ReturnType<typeof setup>>

async function startRequest(fixture: Fixture, stage: RequestStage): Promise<unknown> {
  if (stage === 'read') return fixture.cache.refresh()
  return fixture.cache.execute(fixture.cache.begin(), update)
}

function rejectStage(fixture: Fixture, stage: RequestStage, error: Error) {
  if (stage === 'read') fixture.read.mockRejectedValueOnce(error)
  else fixture.execute.mockRejectedValueOnce(error)
}

describe('planning request access boundaries', () => {
  it('rejects a canonical snapshot with duplicate active-company rows', async () => {
    const fixture = await setup()
    const duplicateCompany = makeCompany({ id: 'wayne', name: 'Wayne Enterprises' })
    fixture.read.mockResolvedValueOnce({
      ...snapshot('Wayne Enterprises', 2),
      data: makeAppData({ companies: [duplicateCompany, duplicateCompany] }),
    })

    await expect(fixture.cache.refresh()).resolves.toBe(false)
    expect(fixture.store.getState().planning.phase.kind).toBe('failed')
    expect(fixture.store.getState().planning.revision).toBe(1)
  })

  for (const stage of ['read', 'execute'] as const) {
    it(`clears rows, history and pending state atomically after ${stage} reports 401`, async () => {
      const fixture = await setup()
      const publications: boolean[] = []
      fixture.store.subscribe((state) => {
        if (state.planning.context !== null) return
        publications.push(
          state.data.clients.length === 0 &&
            !state.planning.history.canUndo &&
            !state.planning.history.canRedo &&
            state.planning.phase.kind !== 'writing'
        )
      })
      rejectStage(fixture, stage, new PlanningCacheError('Access ended', undefined, 401))
      await startRequest(fixture, stage).catch((error: unknown) => error)
      expect(fixture.store.getState().planning.context).toBeNull()
      expect(fixture.store.getState().data.clients).toEqual([])
      expect(publications).toEqual([true])
    })

    // K2: every 403 keeps data and history and shows the refusal; nothing finer.
    for (const code of ['E_AUTHORIZATION_DENIED', 'E_ACCOUNT_MEMBERSHIP_LOST']) {
      it(`keeps readable rows and history and shows the refusal after ${stage} reports 403/${code}`, async () => {
        const fixture = await setup()
        const history = fixture.store.getState().planning.history
        rejectStage(fixture, stage, new PlanningCacheError('Action refused', code, 403))
        await startRequest(fixture, stage).catch((error: unknown) => error)
        const state = fixture.store.getState()
        expect(state.planning.context).toEqual(context)
        expect(state.data.clients[0]?.name).toBe('Wayne Enterprises')
        expect(state.planning.history).toEqual(history)
        expect(readPlanningError(state.planning.phase)).toMatchObject({ code, status: 403 })
      })
    }

    it(`ignores a delayed ${stage} access-loss error after a new context has loaded`, async () => {
      const fixture = await setup()
      const pending = createDeferred<never>()
      if (stage === 'read') fixture.read.mockImplementationOnce(() => pending.promise)
      else fixture.execute.mockImplementationOnce(() => pending.promise)
      const oldRequest = startRequest(fixture, stage).catch((error: unknown) => error)
      fixture.cache.setContext({ ...context, identity: 'diana-session-2' })
      fixture.read.mockResolvedValueOnce({
        ...snapshot('Gotham', 2),
        access: makePlanningAccess({ role: 'editor' }),
      })
      await fixture.cache.refresh()
      pending.reject(new PlanningCacheError('Previous session ended', undefined, 401))
      await oldRequest
      expect(fixture.store.getState().planning.context?.identity).toBe('diana-session-2')
      expect(fixture.store.getState().data.clients[0]?.name).toBe('Gotham')
      expect(readPlanningError(fixture.store.getState().planning.phase)).toBeNull()
    })
  }

  it('rejects an old mutation response after canonical access changes inside the same company', async () => {
    const fixture = await setup()
    const pending = createDeferred<Success>()
    fixture.execute.mockImplementationOnce(() => pending.promise)
    const draft = fixture.cache.begin()
    const oldRequest = fixture.cache.execute(draft, update).catch((error: unknown) => error)
    const { phase } = fixture.store.getState().planning
    const execution = phase.kind === 'writing' ? phase.write.execution : undefined
    expect(execution).toBeDefined()
    fixture.read.mockResolvedValueOnce({
      ...snapshot('Gotham', 2),
      access: makePlanningAccess({ role: 'editor' }),
    })
    await fixture.cache.refresh()
    pending.resolve({
      status: 'committed',
      mutationId: execution?.mutationId ?? 'missing',
      revision: 2,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      changes: { upserts: [], removed: [] },
    })
    await oldRequest
    expect(fixture.store.getState().data.clients[0]?.name).toBe('Gotham')
    expect(fixture.store.getState().planning.history).toEqual({ canUndo: false, canRedo: false })
    expect(fixture.store.getState().planning.phase.kind).not.toBe('writing')
    await expect(fixture.cache.execute(draft, update)).rejects.toThrow(/context/i)
  })
})
