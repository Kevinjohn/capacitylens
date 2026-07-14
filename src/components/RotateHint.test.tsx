import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { RotateHint } from './RotateHint'

// jsdom has no matchMedia, so the hint never shows by default (every other suite
// relies on that). These tests stub it to simulate a portrait phone.
function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>()
  const mql = {
    matches: initialMatches,
    media: '',
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue(mql as unknown as MediaQueryList),
  )
  return {
    rotate(matches: boolean) {
      mql.matches = matches
      listeners.forEach((cb) => cb({ matches }))
    },
  }
}

beforeEach(() => {
  sessionStorage.removeItem('capacitylens/rotateHintDismissed')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RotateHint', () => {
  it('renders nothing when matchMedia is unavailable (jsdom default)', () => {
    render(<RotateHint />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders nothing in landscape', () => {
    stubMatchMedia(false)
    render(<RotateHint />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the dialog on a portrait phone and dismisses for the session via "Got it"', () => {
    stubMatchMedia(true)
    const { unmount } = render(<RotateHint />)
    expect(screen.getByRole('dialog', { name: 'Best in landscape' })).toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: 'Got it' }).click()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sessionStorage.getItem('capacitylens/rotateHintDismissed')).toBe('1')

    // A remount in the same session (e.g. navigating back to the picker) stays quiet.
    unmount()
    render(<RotateHint />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('hides on rotate to landscape and re-shows on rotate back (until dismissed)', () => {
    const media = stubMatchMedia(true)
    render(<RotateHint />)
    expect(screen.getByRole('dialog', { name: 'Best in landscape' })).toBeInTheDocument()

    act(() => media.rotate(false))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => media.rotate(true))
    expect(screen.getByRole('dialog', { name: 'Best in landscape' })).toBeInTheDocument()
  })
})
