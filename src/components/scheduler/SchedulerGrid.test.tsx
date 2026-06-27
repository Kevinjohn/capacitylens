import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SchedulerGrid } from './SchedulerGrid'
import { useStore } from '../../store/useStore'
import type { AppData } from '@capacitylens/shared/types/entities'
import { DEFAULT_ACCOUNT_ID, makeAppData } from '../../test/fixtures'
import { LAYOUT } from './layout'

const ACC = DEFAULT_ACCOUNT_ID

// SchedulerGrid calls useNavigate (the empty-state "Go to Resources" CTA), so every render must
// sit inside a Router.
function renderGrid() {
  return render(<SchedulerGrid />, { wrapper: MemoryRouter })
}

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
    ],
    timeOff: [],
  })
}

beforeEach(() => {
  useStore.getState().replaceAll(dataset())
  useStore.getState().setActiveAccount(ACC)
  useStore.getState().setOriginDate('2026-06-01')
  useStore.getState().setZoom(1) // widest columns
  useStore.getState().clearFilters()
  useStore.setState((st) => ({ ui: { ...st.ui, collapsedGroups: [] } }))
})

describe('SchedulerGrid', () => {
  it('positions a bar by start date with inclusive width', () => {
    renderGrid()
    const bar = screen.getByTestId('allocation-bar')
    // origin === start -> left is just the visual inset; width is a positive multiple of
    // the (responsive) dayWidth. Exact px geometry is covered by schedulerModel.test.
    expect(bar.style.left).toBe(`${LAYOUT.barInset}px`)
    expect(Number.parseInt(bar.style.width, 10)).toBeGreaterThan(0)
    expect(bar).toHaveAttribute('data-status', 'confirmed')
  })

  it('groups resource rows under their discipline', () => {
    renderGrid()
    expect(screen.getByText('Design')).toBeInTheDocument()
    expect(screen.getByText('Tyler')).toBeInTheDocument()
    expect(screen.getByText(/Wireframes/)).toBeInTheDocument()
  })

  it('exposes grid semantics + an sr-only capacity summary for screen readers', () => {
    renderGrid()
    expect(screen.getByRole('grid', { name: 'Resource schedule' })).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0)
    expect(screen.getByRole('rowheader', { name: /Tyler/ })).toBeInTheDocument()
    expect(screen.getByText(/1 allocation\./)).toBeInTheDocument() // sr-only row summary
  })

  it('folds the per-row utilisation % into the sr-only summary (WCAG 1.3.1)', () => {
    renderGrid()
    // The utilisation % is otherwise only a `title` on a non-interactive span (AT may not expose it);
    // the sr-only summary must carry it, using the "Utilisation" term and the visible-window phrasing.
    expect(screen.getByText(/% utilisation over the visible/)).toBeInTheDocument()
  })

  it('marks over-allocated days and shows a utilization figure', () => {
    // Tyler has 8h on 06-01..06-02; add 4h more on 06-01 -> 12h > 8h available.
    useStore.getState().addAllocation({
      resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 4, status: 'confirmed',
    })
    renderGrid()
    expect(screen.getAllByTestId('over-marker').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('utilization').length).toBeGreaterThan(0)
  })
})

describe('SchedulerGrid visible-window utilisation', () => {
  // A single Mon–Fri resource (8h/day → 40h/week) with a different booking density each week, so the
  // displayed overall % must change EXACTLY with the 1/2/4/8-week toggle (and stay distinct across them).
  function densityDataset(): AppData {
    return makeAppData({
      disciplines: [{ id: 'd1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 }],
      resources: [
        { id: 'r1', accountId: ACC, createdAt: 't', updatedAt: 't', kind: 'person', name: 'Dana', role: 'Designer', disciplineId: 'd1', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111' },
      ],
      clients: [{ id: 'c1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Acme', color: '#222' }],
      projects: [{ id: 'p1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Lightning', clientId: 'c1', color: '#ec4899' }],
      phases: [],
      activities: [{ id: 't1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Wireframes', kind: 'project', projectId: 'p1' }],
      allocations: [
        { id: 'w1', accountId: ACC, createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' }, // wk1 100%
        { id: 'w2', accountId: ACC, createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-08', endDate: '2026-06-12', hoursPerDay: 4, status: 'confirmed' }, // wk2 50%
        { id: 'w34', accountId: ACC, createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-15', endDate: '2026-06-26', hoursPerDay: 2, status: 'confirmed' }, // wk3–4 25%
        // wk5–8 idle
      ],
      timeOff: [],
    })
  }

  // Anchor the timeline AND the focus date at Mon 2026-06-01 so the visible window starts there
  // (leftEdgeIdx stays -1 in jsdom — the container is never measured — so the % anchors at focusDate).
  const renderAtZoom = (zoom: 1 | 2 | 4 | 8) => {
    useStore.getState().replaceAll(densityDataset())
    useStore.getState().setActiveAccount(ACC)
    useStore.getState().clearFilters()
    useStore.setState((st) => ({ ui: { ...st.ui, originDate: '2026-06-01', focusDate: '2026-06-01', zoom, collapsedGroups: [] } }))
    return renderGrid()
  }
  const overallPct = () => Number.parseInt(screen.getByTestId('overall-utilization').textContent ?? '', 10)

  it('the week-range toggle changes the overall % to reflect EXACTLY the visible span', () => {
    // 1w → 40/40 = 100%; 2w → 60/80 = 75%; 4w → 80/160 = 50%; 8w → 80/320 = 25%.
    const v1 = renderAtZoom(1); expect(overallPct()).toBe(100); v1.unmount()
    const v2 = renderAtZoom(2); expect(overallPct()).toBe(75); v2.unmount()
    const v4 = renderAtZoom(4); expect(overallPct()).toBe(50); v4.unmount()
    const v8 = renderAtZoom(8); expect(overallPct()).toBe(25); v8.unmount()
  })

  it('the label tracks the zoom (no longer a fixed "next 2w")', () => {
    const v = renderAtZoom(4)
    expect(screen.getByText('Utilisation · 4w')).toBeInTheDocument()
    v.unmount()
  })
})

describe('SchedulerGrid filters', () => {
  it('hides tentative allocations when "hide tentative" is on', () => {
    useStore.getState().addAllocation({
      resourceId: 'r1', activityId: 't1', startDate: '2026-06-10', endDate: '2026-06-11', hoursPerDay: 2, status: 'tentative',
    })
    const view = renderGrid()
    expect(screen.getAllByTestId('allocation-bar')).toHaveLength(2)
    view.unmount()

    useStore.getState().setFilters({ hideTentative: true })
    renderGrid()
    expect(screen.getAllByTestId('allocation-bar')).toHaveLength(1)
  })

  it('shows an empty state when the search matches nobody', () => {
    useStore.getState().setFilters({ search: 'no-such-person' })
    renderGrid()
    expect(screen.getByTestId('scheduler-empty')).toBeInTheDocument()
  })

  it('collapsing a discipline hides its rows but keeps the header', () => {
    renderGrid()
    expect(screen.getByText('Tyler')).toBeInTheDocument()
    act(() => useStore.getState().toggleGroup('d1'))
    expect(screen.queryByText('Tyler')).not.toBeInTheDocument()
    expect(screen.getByTestId('discipline-group')).toBeInTheDocument()
  })
})

// Feature 2 (the device-global "Snap to week start" pref) — the scroll-idle floor wired through
// onScroll. The PURE floor math is unit-tested in weekSnap.test.ts; here we pin the COMPONENT
// WIRING: the debounce, the drag-freeze respect, the convergence no-op, and the unmount cleanup.
//
// jsdom never lays the grid out (clientWidth === 0), so the geometry effect and the scroll-idle snap
// both early-return (see the "leftEdgeIdx stays -1 in jsdom" note above). We therefore (1) mock
// clientWidth/clientHeight so timelineWidth > 0 and didScroll flips, (2) run rAF synchronously so
// onScroll's body executes inside the dispatched scroll event, and (3) drive WEEK_SNAP_IDLE_MS with
// fake timers. minimise-weekends is forced OFF so the column grid is uniform (dayWidth = floor(944/7)
// = 134, a 938px week) and the snap targets are plain multiples of the week width.
describe('SchedulerGrid — snap to week start (Feature 2 wiring)', () => {
  const DAY_WIDTH = 134 // floor((1200 - leftColWidth 256) / 7) at zoom=1, minimise OFF
  const WEEK = DAY_WIDTH * 7 // 938 — offset of the next Monday from the origin Monday
  // A mid-week nudge: Wed of week 2 (origin index 9). Floors back to week 2's Monday (index 7).
  const NUDGE = 9 * DAY_WIDTH // 1206
  const SNAPPED = 7 * DAY_WIDTH // 938
  let rafSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    // Make the grid measure so timelineWidth > 0 (didScroll flips) and the snap actually runs.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
    // Run the onScroll rAF synchronously so its body executes within the dispatched scroll event; the
    // setTimeout(WEEK_SNAP_IDLE_MS) it arms is still driven by the fake timers below.
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    // Uniform columns → predictable week-multiple offsets.
    useStore.getState().setMinimiseWeekends(false)
    // Anchor BOTH origin and focus on Mon 2026-06-01 so first-paint scrollLeft (focusX) is 0.
    useStore.setState((st) => ({ ui: { ...st.ui, originDate: '2026-06-01', focusDate: '2026-06-01', zoom: 1, collapsedGroups: [] } }))
  })

  afterEach(() => {
    rafSpy.mockRestore()
    vi.useRealTimers()
    delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth
    delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight
    useStore.getState().setSnapToWeekStart(true) // restore the default for other suites
    useStore.getState().setMinimiseWeekends(true)
    useStore.setState({ draggingAllocationId: null })
  })

  // Scroll the grid to `px` and fire the scroll event (the component's onScroll listens for it).
  const scrollTo = (px: number) => {
    const grid = screen.getByTestId('scheduler-grid')
    act(() => {
      grid.scrollLeft = px
      grid.dispatchEvent(new Event('scroll'))
    })
  }

  it('pref ON: a mid-week nudge floors back to the week start after the idle (and not before)', () => {
    useStore.getState().setSnapToWeekStart(true)
    const view = renderGrid()
    const grid = screen.getByTestId('scheduler-grid')

    scrollTo(NUDGE)
    expect(grid.scrollLeft).toBe(NUDGE) // debounce: nothing has moved yet
    act(() => { vi.advanceTimersByTime(50) }) // still inside the idle window
    expect(grid.scrollLeft).toBe(NUDGE)

    act(() => { vi.advanceTimersByTime(100) }) // past WEEK_SNAP_IDLE_MS (120) total
    expect(grid.scrollLeft).toBe(SNAPPED) // floored back to week 2's Monday
    view.unmount()
  })

  it('re-arms on each scroll: two quick scrolls fire only ONE snap, after the final idle', () => {
    useStore.getState().setSnapToWeekStart(true)
    const view = renderGrid()
    const grid = screen.getByTestId('scheduler-grid')

    scrollTo(NUDGE) // arms timer A (would fire at t=120)
    act(() => { vi.advanceTimersByTime(40) }) // t=40, under the idle — no snap yet
    expect(grid.scrollLeft).toBe(NUDGE)
    scrollTo(NUDGE + WEEK) // a second scroll (Wed of week 3) clears A and re-arms timer B (fires t=160)
    act(() => { vi.advanceTimersByTime(40) }) // t=80, still under BOTH idles (A cleared, B fires at 160)
    expect(grid.scrollLeft).toBe(NUDGE + WEEK) // no premature snap

    act(() => { vi.advanceTimersByTime(120) }) // t=200, past timer B → exactly one snap
    expect(grid.scrollLeft).toBe(SNAPPED + WEEK) // floored to week 3's Monday
    view.unmount()
  })

  it('pref OFF: a nudge is left where it lands (no snap timer armed)', () => {
    useStore.getState().setSnapToWeekStart(false)
    const view = renderGrid()
    const grid = screen.getByTestId('scheduler-grid')

    scrollTo(NUDGE)
    act(() => { vi.advanceTimersByTime(500) })
    expect(grid.scrollLeft).toBe(NUDGE) // stays put
    view.unmount()
  })

  it('drag-freeze: a snap armed before a drag bails when it fires mid-drag', () => {
    useStore.getState().setSnapToWeekStart(true)
    const view = renderGrid()
    const grid = screen.getByTestId('scheduler-grid')

    scrollTo(NUDGE) // arms the snap timer
    // A drag begins before the idle elapses; the timeout re-checks live draggingAllocationId and bails.
    act(() => useStore.setState({ draggingAllocationId: 'x' }))
    act(() => { vi.advanceTimersByTime(500) })
    expect(grid.scrollLeft).toBe(NUDGE) // not snapped — the drag-freeze held
    view.unmount()
  })

  it('convergence: a scroll that lands exactly on a week start writes nothing back', () => {
    useStore.getState().setSnapToWeekStart(true)
    const view = renderGrid()
    const grid = screen.getByTestId('scheduler-grid')

    scrollTo(WEEK) // already a Monday offset → helper returns null → no write
    act(() => { vi.advanceTimersByTime(500) })
    expect(grid.scrollLeft).toBe(WEEK)
    view.unmount()
  })

  it('clears the pending snap timer on unmount (no late write to a detached node)', () => {
    useStore.getState().setSnapToWeekStart(true)
    const view = renderGrid()
    const grid = screen.getByTestId('scheduler-grid')

    scrollTo(NUDGE) // arm the snap
    view.unmount() // cleanup effect clears snapTimer
    // Advancing past the idle must NOT throw or write (the timer was cleared). The detached node's
    // scrollLeft stays at the nudged value.
    expect(() => act(() => { vi.advanceTimersByTime(500) })).not.toThrow()
    expect(grid.scrollLeft).toBe(NUDGE)
  })
})
