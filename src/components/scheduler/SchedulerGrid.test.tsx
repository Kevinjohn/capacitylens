import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { SchedulerGrid } from './SchedulerGrid'
import { useStore } from '../../store/useStore'
import type { AppData } from '../../types/entities'

function dataset(): AppData {
  return {
    disciplines: [{ id: 'd1', createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 }],
    resources: [
      { id: 'r1', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Tyler', role: 'Designer', disciplineId: 'd1', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111' },
    ],
    clients: [{ id: 'c1', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#222' }],
    projects: [{ id: 'p1', createdAt: 't', updatedAt: 't', name: 'Lightning', clientId: 'c1', color: '#ec4899' }],
    phases: [],
    tasks: [{ id: 't1', createdAt: 't', updatedAt: 't', name: 'Wireframes', projectId: 'p1' }],
    allocations: [
      { id: 'a1', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
    ],
    timeOff: [],
  }
}

beforeEach(() => {
  useStore.getState().replaceAll(dataset())
  useStore.getState().setOriginDate('2026-06-01')
  useStore.getState().setZoom(1) // widest columns
  useStore.getState().clearFilters()
  useStore.setState((st) => ({ ui: { ...st.ui, collapsedGroups: [] } }))
})

describe('SchedulerGrid', () => {
  it('positions a bar by start date with inclusive width', () => {
    render(<SchedulerGrid />)
    const bar = screen.getByTestId('allocation-bar')
    // origin === start -> left 0; width is a positive multiple of the (responsive) dayWidth.
    // Exact px geometry is covered by schedulerModel.test with an explicit dayWidth.
    expect(bar.style.left).toBe('0px')
    expect(Number.parseInt(bar.style.width, 10)).toBeGreaterThan(0)
    expect(bar).toHaveAttribute('data-status', 'confirmed')
  })

  it('groups resource rows under their discipline', () => {
    render(<SchedulerGrid />)
    expect(screen.getByText('Design')).toBeInTheDocument()
    expect(screen.getByText('Tyler')).toBeInTheDocument()
    expect(screen.getByText(/Wireframes/)).toBeInTheDocument()
  })

  it('marks over-allocated days and shows a utilization figure', () => {
    // Tyler has 8h on 06-01..06-02; add 4h more on 06-01 -> 12h > 8h available.
    useStore.getState().addAllocation({
      resourceId: 'r1', taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 4, status: 'confirmed',
    })
    render(<SchedulerGrid />)
    expect(screen.getAllByTestId('over-marker').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('utilization').length).toBeGreaterThan(0)
  })
})

describe('SchedulerGrid filters', () => {
  it('hides tentative allocations when "hide tentative" is on', () => {
    useStore.getState().addAllocation({
      resourceId: 'r1', taskId: 't1', startDate: '2026-06-10', endDate: '2026-06-11', hoursPerDay: 2, status: 'tentative',
    })
    const view = render(<SchedulerGrid />)
    expect(screen.getAllByTestId('allocation-bar')).toHaveLength(2)
    view.unmount()

    useStore.getState().setFilters({ hideTentative: true })
    render(<SchedulerGrid />)
    expect(screen.getAllByTestId('allocation-bar')).toHaveLength(1)
  })

  it('shows an empty state when the search matches nobody', () => {
    useStore.getState().setFilters({ search: 'no-such-person' })
    render(<SchedulerGrid />)
    expect(screen.getByTestId('scheduler-empty')).toBeInTheDocument()
  })

  it('collapsing a discipline hides its rows but keeps the header', () => {
    render(<SchedulerGrid />)
    expect(screen.getByText('Tyler')).toBeInTheDocument()
    act(() => useStore.getState().toggleGroup('d1'))
    expect(screen.queryByText('Tyler')).not.toBeInTheDocument()
    expect(screen.getByTestId('discipline-group')).toBeInTheDocument()
  })
})
