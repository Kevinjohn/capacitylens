import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { useDemoAuthActive, FAKE_USER } from './fakeAuth'
import { AuthContext, type AuthContextValue } from '../auth/authContext'

// useDemoAuthActive is a thin predicate over the auth context: true only when authMode is
// 'off' (the real auth seam disabled). Cover both branches via a Provider so the mutant
// `return true` (unconditional) is caught by the 'password' case below.

const withAuthMode = (authMode: AuthContextValue['authMode']) => {
  const value: AuthContextValue = {
    authMode,
    user: null,
    canCreateAccount: true,
    multiAccount: true,
    refreshAuth: async () => {},
    signOut: async () => {},
  }
  return ({ children }: { children: ReactNode }) =>
    createElement(AuthContext.Provider, { value }, children)
}

describe('useDemoAuthActive', () => {
  it('is true when authMode is off (default, no provider)', () => {
    const { result } = renderHook(() => useDemoAuthActive())
    expect(result.current).toBe(true)
  })

  it('is true when authMode is explicitly off', () => {
    const { result } = renderHook(() => useDemoAuthActive(), { wrapper: withAuthMode('off') })
    expect(result.current).toBe(true)
  })

  it('is false when real auth is on (password)', () => {
    const { result } = renderHook(() => useDemoAuthActive(), { wrapper: withAuthMode('password') })
    expect(result.current).toBe(false)
  })

  it('is false when real auth is on (sso)', () => {
    const { result } = renderHook(() => useDemoAuthActive(), { wrapper: withAuthMode('sso') })
    expect(result.current).toBe(false)
  })
})

describe('FAKE_USER', () => {
  it('is the cosmetic demo persona', () => {
    expect(FAKE_USER).toEqual({ name: 'Jordan Avery', email: 'jordan.avery@example.com' })
  })
})
