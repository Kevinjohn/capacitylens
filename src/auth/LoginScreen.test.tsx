import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock the Better Auth client so the form can submit without a real server. signIn.email returns a
// FAILURE shape ({ error }) so the form sets its inline error and the per-control describedby wires up.
const signInEmail = vi.fn()
vi.mock('./authClient', () => ({
  authClient: { signIn: { email: (...args: unknown[]) => signInEmail(...args), oauth2: vi.fn() } },
}))

import { LoginScreen } from './LoginScreen'

beforeEach(() => {
  signInEmail.mockReset()
})

describe('LoginScreen — per-control error cues (WCAG 3.3.1)', () => {
  it('gives the email/password inputs ids and no aria-describedby before any error', () => {
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />)
    const email = screen.getByLabelText('Email')
    const password = screen.getByLabelText('Password')
    // Each control carries a stable id so it can point at the shared error.
    expect(email).toHaveAttribute('id')
    expect(password).toHaveAttribute('id')
    // No error yet → no describedby dangling at a non-existent message.
    expect(email).not.toHaveAttribute('aria-describedby')
    expect(password).not.toHaveAttribute('aria-describedby')
  })

  it('points both inputs at the error message via aria-describedby after a failed sign-in', async () => {
    signInEmail.mockResolvedValue({ error: { message: 'Invalid email or password.' } })
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    // The role=alert error renders, and BOTH inputs describe it (re-announced on re-navigation).
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid email or password.')
    const errorId = alert.getAttribute('id')
    expect(errorId).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', errorId)
      expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', errorId)
    })
  })
})
