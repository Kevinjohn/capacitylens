import { render as rtlRender, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { OwnerPermissions } from '@/test/ownerPermissions'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_COMPANY_ID,
  makeActivity,
  makeAllocation,
  makeCompany,
  makeAppData,
  makeResource,
  resetStoreWithCompany,
  resetStoreWithData,
} from '@/test/fixtures'
import { useStore } from '@/store/useStore'
import { getStubPlanningTransport } from '@/test/planningTransportHandle'
import { CapacityOverviewView } from './CapacityOverviewView'

function render(ui: ReactNode) {
  return rtlRender(ui, { wrapper: OwnerPermissions })
}

vi.mock('@/hooks/useCompanyToday', () => ({
  useCompanyToday: () => '2026-09-10',
}))

describe('CapacityOverviewView', () => {
  beforeEach(() => resetStoreWithCompany())

  function renderOverview() {
    useStore.setState({
      activeCompanyId: DEFAULT_COMPANY_ID,
      data: makeAppData({
        companies: [makeCompany({ schedulingMode: 'days', disciplinesEnabled: false })],
        resources: [
          makeResource({ id: 'clark', companyId: DEFAULT_COMPANY_ID, name: 'Clark Kent' }),
        ],
      }),
    })
    return render(<CapacityOverviewView />)
  }

  it('builds the current company overview from active scoped data', () => {
    useStore.setState({
      activeCompanyId: DEFAULT_COMPANY_ID,
      data: makeAppData({
        companies: [makeCompany({ schedulingMode: 'days', disciplinesEnabled: false })],
        resources: [
          makeResource({ id: 'clark', companyId: DEFAULT_COMPANY_ID, name: 'Clark Kent' }),
        ],
      }),
    })

    render(<CapacityOverviewView />)

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Clark Kent/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '10 – 13 Sep' })).toBeInTheDocument()
  })

  it('draws the capacity figures built from the planning rows', async () => {
    // Thursday 10 to Sunday 13 September: two free weekdays, one booked in full, and a weekend.
    await resetStoreWithData(
      makeAppData({
        companies: [makeCompany({ schedulingMode: 'days', disciplinesEnabled: false })],
        resources: [
          makeResource({ id: 'clark', companyId: DEFAULT_COMPANY_ID, name: 'Clark Kent' }),
        ],
        activities: [makeActivity({ companyId: DEFAULT_COMPANY_ID })],
        allocations: [
          makeAllocation({
            companyId: DEFAULT_COMPANY_ID,
            resourceId: 'clark',
            startDate: '2026-09-10',
            endDate: '2026-09-10',
          }),
        ],
      })
    )
    getStubPlanningTransport().setToday('2026-09-10')
    await useStore.getState().refreshPlanning({ fresh: true })

    render(<CapacityOverviewView />)

    const cells = within(screen.getByRole('row', { name: /Clark Kent/ })).getAllByRole('cell')
    expect(cells[0]).toHaveAttribute('title', '10 – 13 Sep · 1d free of 2d')
  })

  it('starts on the Ledger with tentative work shown and totals hidden', () => {
    renderOverview()

    expect(screen.getByRole('radio', { name: 'Ledger' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Tentative' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Has availability' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Totals' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Capacity across the next 4 weeks')).toBeInTheDocument()
  })

  it('switches between the four-, eight- and twelve-week horizons without resetting other controls', async () => {
    const user = userEvent.setup()
    renderOverview()

    const table = screen.getByRole('table', { name: 'Overview' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
    expect(screen.getByRole('radio', { name: '4 weeks' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: '12 weeks' }))

    expect(within(table).getAllByRole('columnheader')).toHaveLength(13)
    expect(screen.getByRole('columnheader', { name: '5 – 11 Oct' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '23 – 29 Nov' })).toBeInTheDocument()
    expect(screen.getByText('Capacity across the next 12 weeks')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tentative' }))
    await user.click(screen.getByRole('button', { name: 'Totals' }))
    await user.click(screen.getByRole('radio', { name: '8 weeks' }))

    expect(within(table).getAllByRole('columnheader')).toHaveLength(9)
    expect(screen.getByText('Capacity across the next 8 weeks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentative' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Totals' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('capacity-overview-totals-cell')).toHaveLength(8)
  })

  it('resets the horizon when Overview is remounted', async () => {
    const user = userEvent.setup()
    const { unmount } = renderOverview()
    await user.click(screen.getByRole('radio', { name: '12 weeks' }))
    unmount()

    renderOverview()

    expect(screen.getByRole('radio', { name: '4 weeks' })).toHaveAttribute('aria-checked', 'true')
    expect(
      within(screen.getByRole('table', { name: 'Overview' })).getAllByRole('columnheader')
    ).toHaveLength(5)
  })

  it('keeps a collapsed group collapsed while the horizon changes', async () => {
    const user = userEvent.setup()
    renderOverview()

    const groupToggle = screen.getByRole('button', { name: /Overall/ })
    await user.click(groupToggle)
    await user.click(screen.getByRole('radio', { name: '12 weeks' }))

    expect(groupToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('row', { name: /Clark Kent/ })).not.toBeInTheDocument()
  })

  it('opens the person schedule drawer from an Overview row', async () => {
    const user = userEvent.setup()
    useStore.setState({
      activeCompanyId: DEFAULT_COMPANY_ID,
      data: makeAppData({
        companies: [makeCompany({ schedulingMode: 'days', disciplinesEnabled: false })],
        resources: [
          makeResource({ id: 'clark', companyId: DEFAULT_COMPANY_ID, name: 'Clark Kent' }),
        ],
      }),
    })

    render(<CapacityOverviewView />)

    const trigger = screen.getByRole('button', { name: "View Clark Kent's schedule CK" })
    expect(trigger).toHaveAttribute('data-testid', 'person-schedule-trigger')
    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: "Clark Kent's schedule" })).toBeVisible()
    expect(screen.getByTestId('person-schedule-sheet')).toBeInTheDocument()
  })

  it('uses the Blocks-mode explanation for an unmeasured company', () => {
    useStore.setState({
      activeCompanyId: DEFAULT_COMPANY_ID,
      data: makeAppData({ companies: [makeCompany({ schedulingMode: 'blocks' })] }),
    })

    render(<CapacityOverviewView />)

    expect(
      screen.getByRole('heading', { name: 'Overview needs measured capacity' })
    ).toBeInTheDocument()
  })
})
