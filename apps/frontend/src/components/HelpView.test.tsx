import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionContext } from '@/auth/permissionContext'
import type { Role } from '@capacitylens/shared/domain/access'
import { HelpView } from './HelpView'
import { permissionValue } from '@/test/permissionGrants'

const tourMock = vi.hoisted(() => ({
  startTour: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/lib/tour', () => ({ startTour: tourMock.startTour }))

beforeEach(() => tourMock.startTour.mockReset().mockResolvedValue(undefined))

function renderHelp(role: Role, showOrientation = vi.fn()) {
  return render(
    <PermissionContext.Provider value={permissionValue(role, 'resolved')}>
      <MemoryRouter initialEntries={['/help']}>
        <Routes>
          <Route element={<Outlet context={{ showOrientation }} />}>
            <Route path="help" element={<HelpView />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </PermissionContext.Provider>
  )
}

describe('HelpView', () => {
  it.each(['owner', 'admin', 'editor', 'viewer'] as const)(
    'offers the shared role tour to %s',
    async (role) => {
      const user = userEvent.setup()
      renderHelp(role)

      expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Browse the user guides' })).toHaveAttribute(
        'href',
        'https://kevinjohn.github.io/capacitylens/using/'
      )
      const launcher = screen.getByTestId('show-tour')
      expect(launcher).toHaveAccessibleName('Show tour')
      expect(launcher).toBeEnabled()
      await user.click(launcher)

      expect(tourMock.startTour).toHaveBeenCalledWith(expect.objectContaining({ role }))
    }
  )

  it.each([
    ['owner', true],
    ['admin', true],
    ['editor', false],
    ['viewer', false],
  ] as const)('%s sees the Diagnostics link: %s', (role, visible) => {
    renderHelp(role)

    const link = screen.queryByRole('link', { name: 'Diagnostics' })
    if (visible) expect(link).toHaveAttribute('href', '/diagnostics')
    else expect(link).not.toBeInTheDocument()
  })

  it('reopens the orientation from its own button', async () => {
    const showOrientation = vi.fn()
    const user = userEvent.setup()
    renderHelp('viewer', showOrientation)

    const button = screen.getByTestId('product-orientation-reopen')
    expect(button).toHaveAccessibleName('How CapacityLens works')
    await user.click(button)

    expect(showOrientation).toHaveBeenCalledExactlyOnceWith(button)
  })
})
