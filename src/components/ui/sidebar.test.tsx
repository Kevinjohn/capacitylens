import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar, SidebarProvider, useSidebar } from './sidebar'

function mobileMediaQuery(): MediaQueryList {
  return {
    matches: true,
    media: '(max-width: 767px)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }
}

function OpenMobileSidebar({ children }: { children: React.ReactNode }) {
  const { setOpenMobile } = useSidebar()
  React.useEffect(() => setOpenMobile(true), [setOpenMobile])
  return children
}

describe('Sidebar responsive DOM contract', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('forwards advertised div props and className to the mobile sheet content', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => mobileMediaQuery()))

    render(
      <SidebarProvider>
        <OpenMobileSidebar>
          <Sidebar
            aria-label="Contract sidebar"
            className="contract-class"
            data-testid="contract-sidebar"
            id="contract-id"
            style={{ opacity: 0.75 }}
          >
            Sidebar content
          </Sidebar>
        </OpenMobileSidebar>
      </SidebarProvider>,
    )

    const sidebar = await screen.findByTestId('contract-sidebar')
    expect(sidebar).toHaveAttribute('aria-label', 'Contract sidebar')
    expect(sidebar).toHaveAttribute('id', 'contract-id')
    expect(sidebar).toHaveClass('contract-class')
    expect(sidebar).toHaveStyle({ opacity: '0.75' })
    expect(sidebar.style.getPropertyValue('--sidebar-width')).toBe('18rem')
  })
})
