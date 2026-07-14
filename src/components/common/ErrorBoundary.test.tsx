import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { ErrorBoundary, ErrorFallback, RouteError } from './ErrorBoundary'

function Boom(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>
    )

    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('shows "Something went wrong" and a Reload button when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()

    spy.mockRestore()
  })

  it('displays the thrown error message in the fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByText('boom')).toBeInTheDocument()

    spy.mockRestore()
  })
})

describe('RouteError (React Router errorElement)', () => {
  it('renders the branded recovery screen when a route element throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteError /> }])

    render(<RouterProvider router={router} />)

    // The data router catches the in-tree throw and renders our errorElement (NOT its
    // own bland default), so the recovery UI appears.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()

    spy.mockRestore()
  })
})

describe('ErrorFallback', () => {
  it('shows a default message when none is provided (never a blank screen)', () => {
    render(<ErrorFallback />)
    expect(screen.getByText('An unexpected error occurred.')).toBeInTheDocument()
  })
})
