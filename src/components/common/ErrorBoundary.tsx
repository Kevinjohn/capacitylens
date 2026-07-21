import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import { errorMessage } from '../../lib/errorMessage'
import { m } from '@/i18n'
import { Button } from '../ui/button'

/** The branded "something broke — reload" recovery screen, shared by the top-level
 *  class boundary and the router's errorElement so both render identically. */
export function ErrorFallback({ message }: { message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">{m.boundary_title()}</h1>
      <p className="max-w-md text-sm text-muted">{message || m.boundary_message()}</p>
      <Button onClick={() => window.location.reload()}>
        {m.boundary_reload()}
      </Button>
    </div>
  )
}

/** React Router v7 route `errorElement`. A data router catches in-tree render/loader
 *  errors in its OWN per-route boundary — they never propagate to the React
 *  <ErrorBoundary> wrapping <RouterProvider> — so the app's recovery screen must be
 *  wired HERE for any view crash (SchedulerView, a list page, AppShell, …) to show it. */
export function RouteError() {
  const error = useRouteError()
  if (error) console.error('CapacityLens route error:', error)
  return <ErrorFallback message={errorMessage(error)} />
}

interface State {
  error: Error | null
}

/** Top-level class boundary for errors thrown OUTSIDE the router tree (e.g. by
 *  <RouterProvider> itself). In-tree route errors are handled by {@link RouteError}. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CapacityLens crashed:', error, info)
  }

  render() {
    if (this.state.error) return <ErrorFallback message={errorMessage(this.state.error)} />
    return this.props.children
  }
}
