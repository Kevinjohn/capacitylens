import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SchedulerGrid } from './SchedulerGrid'
import { useStore } from '../../store/useStore'
import type { AppData } from '@floaty/shared/types/entities'
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
