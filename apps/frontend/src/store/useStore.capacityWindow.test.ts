import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCapacitySection } from '@capacitylens/shared/lib/capacity'
import { useStore } from './useStore'
import { buildPlanningCapacity } from './planningCapacity'
import { PLANNING_REVALIDATION_INTERVAL_MS } from './slices/planningSessionSlice'
import { buildVisibleRange } from './selectors'
import {
  DEFAULT_COMPANY_ID,
  makeActivity,
  makeAllocation,
  makeAppData,
  makeResource,
  resetStoreWithData,
} from '@/test/fixtures'
import {
  getPlanningTransportHandle,
  getStubPlanningTransport,
} from '@/test/planningTransportHandle'

const gridWindow = () => {
  const { start, end } = buildVisibleRange(useStore.getState().ui)
  return { from: start, to: end }
}

// One eight-hour weekday person, booked over capacity on Wednesday 3 June 2026.
const seed = () =>
  makeAppData({
    resources: [makeResource({ companyId: DEFAULT_COMPANY_ID })],
    activities: [makeActivity({ companyId: DEFAULT_COMPANY_ID })],
    allocations: [
      makeAllocation({
        companyId: DEFAULT_COMPANY_ID,
        startDate: '2026-06-03',
        endDate: '2026-06-03',
        hoursPerDay: 9,
      }),
    ],
  })

describe('planning capacity in the browser', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('moving and zooming a ready grid reads nothing and builds the figures for the new window', async () => {
    await resetStoreWithData(seed())
    const transport = getStubPlanningTransport()
    const reads = transport.reads.length
    const before = buildPlanningCapacity(useStore.getState())
    expect(before?.window).toEqual(gridWindow())

    useStore.getState().panDays(7)
    useStore.getState().setZoom(8)
    useStore.getState().panDays(-14)
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(transport.reads).toHaveLength(reads)
    expect(useStore.getState().planning.phase.kind).toBe('ready')
    const { data, planning } = useStore.getState()
    const after = buildPlanningCapacity(useStore.getState())
    expect(after?.window).toEqual(gridWindow())
    expect(after).toEqual(
      buildCapacitySection({
        data,
        company: data.companies[0],
        today: planning.today ?? '',
        window: gridWindow(),
      })
    )
  })

  it('returns the same figures while nothing they depend on changes', async () => {
    await resetStoreWithData(seed())
    const first = buildPlanningCapacity(useStore.getState())
    useStore.getState().setNotice('Unrelated', 'info')
    expect(buildPlanningCapacity(useStore.getState())).toBe(first)
    useStore.getState().panDays(7)
    expect(buildPlanningCapacity(useStore.getState())).not.toBe(first)
  })

  it('has no figures before a read has supplied the company date', () => {
    expect(
      buildPlanningCapacity({
        ...useStore.getState(),
        planning: { ...useStore.getState().planning, today: null },
      })
    ).toBeNull()
  })
})

describe('planning freshness check', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('names the held revision and keeps the rows when nothing changed, at most once per interval', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await resetStoreWithData(seed())
    const transport = getStubPlanningTransport()
    const rows = useStore.getState().data
    const reads = transport.reads.length

    await expect(useStore.getState().revalidatePlanning()).resolves.toBe(true)
    expect(transport.reads).toHaveLength(reads + 1)
    expect(transport.reads.at(-1)?.ifRevision).toBe(useStore.getState().planning.revision)
    expect(useStore.getState().data).toBe(rows)

    vi.advanceTimersByTime(PLANNING_REVALIDATION_INTERVAL_MS - 1)
    await expect(useStore.getState().revalidatePlanning()).resolves.toBe(false)
    expect(transport.reads).toHaveLength(reads + 1)

    vi.advanceTimersByTime(1)
    await expect(useStore.getState().revalidatePlanning()).resolves.toBe(true)
    expect(transport.reads).toHaveLength(reads + 2)
  })

  it("takes another member's committed change", async () => {
    await resetStoreWithData(seed())
    const transport = getStubPlanningTransport()
    const revision = useStore.getState().planning.revision
    const changed = seed()
    changed.allocations = changed.allocations.map((row) => ({ ...row, hoursPerDay: 4 }))
    transport.updateSource(changed)

    await expect(useStore.getState().revalidatePlanning()).resolves.toBe(true)

    expect(transport.reads.at(-1)?.ifRevision).toBe(revision)
    expect(useStore.getState().planning.revision).toBe((revision ?? 0) + 1)
    expect(useStore.getState().data.allocations[0]?.hoursPerDay).toBe(4)
    const capacity = buildPlanningCapacity(useStore.getState())
    expect(capacity?.resources['r1']?.window.over).not.toContain(true)
  })

  it('takes a new company date and rebuilds the figures from it', async () => {
    await resetStoreWithData(seed())
    const transport = getStubPlanningTransport()
    transport.setToday('2026-06-02')
    await useStore.getState().refreshPlanning({ fresh: true })
    expect(buildPlanningCapacity(useStore.getState())?.resources['r1']?.overSoon).toBe(true)

    // The day after the over-capacity day rolls it out of the two weeks from today.
    transport.setToday('2026-06-04')
    await expect(useStore.getState().revalidatePlanning()).resolves.toBe(true)

    expect(transport.reads.at(-1)?.ifRevision).toBe(useStore.getState().planning.revision)
    expect(useStore.getState().planning.today).toBe('2026-06-04')
    const capacity = buildPlanningCapacity(useStore.getState())
    expect(capacity?.horizon.from).toBe('2026-06-04')
    expect(capacity?.resources['r1']?.overSoon).toBe(false)
  })

  it('reads nothing while a read or write is in flight', async () => {
    await resetStoreWithData(seed())
    const transport = getStubPlanningTransport()
    const release = transport.holdNextRead()
    const loading = useStore.getState().refreshPlanning({ fresh: true })
    const reads = transport.reads.length

    await expect(useStore.getState().revalidatePlanning()).resolves.toBe(false)
    expect(transport.reads).toHaveLength(reads)
    release()
    await loading
  })

  it('retries a failed read whenever it is asked', async () => {
    await resetStoreWithData(seed())
    vi.spyOn(getPlanningTransportHandle(), 'read').mockRejectedValueOnce(
      new TypeError('read unavailable')
    )
    await useStore.getState().refreshPlanning({ fresh: true })
    expect(useStore.getState().planning.phase.kind).toBe('failed')

    await expect(useStore.getState().revalidatePlanning()).resolves.toBe(true)
    expect(useStore.getState().planning.phase.kind).toBe('ready')
  })

  it('retries the read after a committed write whose read failed, so editing resumes', async () => {
    await resetStoreWithData(seed())
    const [allocation] = useStore.getState().data.allocations
    if (!allocation) throw new Error('The seed holds one allocation.')
    vi.spyOn(getPlanningTransportHandle(), 'read').mockRejectedValueOnce(
      new TypeError('read unavailable')
    )
    await useStore.getState().sendPlanningIntent({
      intent: {
        operation: 'allocation.update',
        id: allocation.id,
        changes: { hoursPerDay: 4 },
      },
    })
    const { phase } = useStore.getState().planning
    expect(phase.kind === 'writing' && phase.readError).toBeInstanceOf(TypeError)

    await expect(useStore.getState().revalidatePlanning()).resolves.toBe(true)
    expect(useStore.getState().planning.phase.kind).toBe('ready')
    expect(useStore.getState().data.allocations[0]?.hoursPerDay).toBe(4)
  })
})
