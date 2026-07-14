import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock the Better Auth client so the forms can submit without a real server. signIn.email /
// signUp.email return the library's FAILURE shape ({ error }) so each form sets its inline error
// and the per-control describedby wires up.
const signInEmail = vi.fn()
const signUpEmail = vi.fn()
vi.mock('./authClient', () => ({
  authClient: {
    signIn: { email: (...args: unknown[]) => signInEmail(...args), oauth2: vi.fn() },
    signUp: { email: (...args: unknown[]) => signUpEmail(...args) },
  },
}))

import { LoginScreen } from './LoginScreen'

beforeEach(() => {
  signInEmail.mockReset()
  signUpEmail.mockReset()
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

// First-run owner setup: needsSetup (server-reported: password mode + zero users) swaps the
// sign-in form for a create-the-owner-account form; success proceeds exactly like a sign-in.
describe('LoginScreen — first-run owner setup (needsSetup)', () => {
  it('renders the owner-setup form instead of sign-in when needsSetup', () => {
    render(<LoginScreen authMode="password" needsSetup onSignedIn={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Create the owner account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Setup token')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create owner account' })).toBeInTheDocument()
    // The ordinary sign-in affordances are replaced, not stacked.
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('renders the ordinary sign-in form when needsSetup is absent (fail-closed default)', () => {
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('submits name/email/password through signUp.email and calls onSignedIn on success', async () => {
    signUpEmail.mockResolvedValue({ data: {}, error: null })
    const onSignedIn = vi.fn()
    render(<LoginScreen authMode="password" needsSetup onSignedIn={onSignedIn} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Owner' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@x.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-strong-password' } })
    fireEvent.change(screen.getByLabelText('Setup token'), { target: { value: 'operator-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create owner account' }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
    expect(signUpEmail).toHaveBeenCalledWith({
      email: 'owner@x.test',
      password: 'a-strong-password',
      name: 'Owner',
      fetchOptions: { headers: { 'x-capacitylens-setup-token': 'operator-secret' } },
    })
  })

  it('surfaces a sign-up failure inline and describes every field by it (same WCAG contract as sign-in)', async () => {
    signUpEmail.mockResolvedValue({ error: { message: 'Password too short' } })
    const onSignedIn = vi.fn()
    render(<LoginScreen authMode="password" needsSetup onSignedIn={onSignedIn} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Owner' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@x.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create owner account' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Password too short')
    expect(onSignedIn).not.toHaveBeenCalled()
    const errorId = alert.getAttribute('id')
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveAttribute('aria-describedby', errorId)
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', errorId)
      expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', errorId)
      expect(screen.getByLabelText('Setup token')).toHaveAttribute('aria-describedby', errorId)
    })
    // The button recovers (busy reset) so the user can retry after fixing the input.
    expect(screen.getByRole('button', { name: 'Create owner account' })).toBeEnabled()
  })

  it('drops out of setup into the ordinary sign-in form when another operator wins the setup race', async () => {
    // Better Auth's live per-request gate (server/src/auth.ts) refuses a SECOND sign-up with this
    // exact typed code once a user exists — the shape a losing second tab/operator would see.
    signUpEmail.mockResolvedValue({
      error: { message: 'Email and password sign up is not enabled', code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' },
    })
    const onSignedIn = vi.fn()
    render(<LoginScreen authMode="password" needsSetup onSignedIn={onSignedIn} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Owner' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@x.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create owner account' }))

    // The dead end is fixed: the screen switches to the ordinary sign-in form...
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Someone has already set this workspace up — sign in below.')
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    })
    // ...the create-owner fields are gone, replaced by the sign-in ones...
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    // ...and the explanatory message is still visible so the user understands why.
    expect(screen.getByRole('alert')).toHaveTextContent('Someone has already set this workspace up — sign in below.')
    expect(onSignedIn).not.toHaveBeenCalled()
  })
})
