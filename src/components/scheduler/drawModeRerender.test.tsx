import { describe, it, expect, beforeEach, vi } from 'vitest'
import { memo } from 'react'
import { act, render, screen } from '@testing-library/react'
import type { AppData } from '@floaty/shared/types/entities'
import { useStore } from '../../store/useStore'
import { DEFAULT_ACCOUNT_ID, makeAppData } from '../../test/fixtures'

// The point of this whole suite: toggling the Time-off draw mode must re-render ONLY each lane's
// thin BarsLayer (which flips `inert`), NOT the AllocationBars inside it. The bars bail purely on
// referential stability of the props BarsLayer hands them — so we mount the REAL SchedulerGrid /
// ResourceLane / BarsLayer and replace ONLY the leaf AllocationBar with a memoised render-counter.
//
// Memoised exactly like the real bar (React.memo), so the counter re-renders IFF one of its props
// changed identity — i.e. it is a faithful stand-in for the production bail condition. What this
// test actually catches is the `handleDraw`/`onDraw` reference stability: on the round-1 code
// `onDraw` closed over `ui.drawMode`, so a toggle re-rendered SchedulerGrid → new `onDraw` →
// ResourceLane re-rendered → every bar re-rendered. With `onDraw` stabilised (getState-backed,
// `[]` deps), ResourceLane's props no longer change, its memo bails, and the count holds. The test
// is gated on that stabilisation alone — reverting it fails; reverting only `indexAt` to a fresh
// inline closure still passes, since ResourceLane no longer re-renders on a toggle. So this does NOT
// independently exercise the `indexAt` memoisation (which is defense-in-depth for a future case
// where a lane prop goes unstable across a toggle).
const barRenderCount = vi.fn()
vi.mock('./AllocationBar', () => ({
  AllocationBar: memo(function AllocationBarSpy({ bar }: { bar: { allocation: { id: string } } }) {
    barRenderCount()
    return <div data-testid="allocation-bar" data-alloc-id={bar.allocation.id} />
  }),
}))

const ACC = DEFAULT_ACCOUNT_ID

function dataset(): AppData {
  return makeAppData({
    disciplines: [{ id: 'd1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 }],
    resources: [
      { id: 'r1', accountId: ACC, createdAt: 't', updatedAt: 't', kind: 'person', name: 'Tyler', role: 'Designer', disciplineId: 'd1', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111' },
    ],
    clients: [{ id: 'c1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Acme', color: '#222' }],
    projects: [{ id: 'p1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Lightning', clientId: 'c1', color: '#ec4899' }],
    phases: [],
    activities: [{ id: 't1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Wireframes', kind: 'project', projectId: 'p1' }],
    allocations: [
      { id: 'a1', accountId: ACC, createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a2', accountId: ACC, createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-04', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
    ],
    timeOff: [],
  })
}

beforeEach(() => {
  barRenderCount.mockClear()
  useStore.getState().replaceAll(dataset())
  useStore.getState().setActiveAccount(ACC)
  useStore.getState().setOriginDate('2026-06-01')
  useStore.getState().setZoom(1)
  useStore.getState().setDrawMode('work')
  useStore.getState().clearFilters()
  useStore.setState((st) => ({ ui: { ...st.ui, collapsedGroups: [] } }))
})

describe('draw-mode toggle does not re-render allocation bars', () => {
  it('toggling to Time off re-renders only the BarsLayer (inert) — the bars bail', async () => {
    // The grid mounts the real SchedulerGrid → ResourceLane → BarsLayer; only the leaf bar is mocked.
    const { SchedulerGrid } = await import('./SchedulerGrid')
    render(<SchedulerGrid />)

    // Sanity: the two bars rendered once on mount (this is the baseline to hold across the toggle).
    expect(screen.getAllByTestId('allocation-bar')).toHaveLength(2)
    const beforeToggle = barRenderCount.mock.calls.length
    expect(beforeToggle).toBeGreaterThan(0)

    // Flip to Time-off mode. This is what the toolbar toggle does. BarsLayer subscribes to drawMode,
    // so it re-renders and applies `inert`; nothing else should.
    act(() => {
      useStore.getState().setDrawMode('timeoff')
    })

    // PROOF #1: no AllocationBar re-rendered as a result of the toggle (the round-1 regression).
    expect(barRenderCount.mock.calls.length).toBe(beforeToggle)

    // PROOF #2: the toggle DID take effect — `inert` is applied via the ANCESTOR bars layer, so the
    // bars are non-interactive without having re-rendered. The bars layer is the parent <div> that
    // wraps the bar elements.
    const bar = screen.getAllByTestId('allocation-bar')[0]
    const barsLayer = bar.parentElement
    expect(barsLayer).not.toBeNull()
    expect(barsLayer).toHaveAttribute('inert')

    // Toggling back to work mode likewise must not re-render the bars (and clears inert).
    act(() => {
      useStore.getState().setDrawMode('work')
    })
    expect(barRenderCount.mock.calls.length).toBe(beforeToggle)
    expect(screen.getAllByTestId('allocation-bar')[0].parentElement).not.toHaveAttribute('inert')
  })
})
