import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReauthDialog } from './ReauthDialog'
import { reauthPending, requestReauth, resolveReauth, subscribeReauth } from './reauthCoordinator'
import type { AuthProviderInfo, AuthUser } from './authContext'

// DEFECT B — the "Confirm it's you" step-up dialog. Better Auth's client is mocked so we can drive a
// success / failure without a network. The dialog resolves the coordinator on success (which the
// wrapper turns into a retry) and shows the failure INLINE without closing.

const signInEmail = vi.fn()
vi.mock('./authClient', () => ({
  authClient: {
    signIn: { email: (...args: unknown[]) => signInEmail(...args), oauth2: vi.fn(), social: vi.fn() },
    twoFactor: { verifyTotp: vi.fn() },
  },
}))

// The real bridge (ReauthMount in AuthProvider) is this exact shape: show the dialog only while a
// step-up is pending. Rendering it here lets us assert the dialog opens on requestReauth() and
// UNMOUNTS (closes) when the coordinator resolves.
function Harness({
  user,
  providers = [],
}: {
  user: AuthUser | null
  providers?: AuthProviderInfo[]
}) {
  const pending = useSyncExternalStore(subscribeReauth, reauthPending)
  if (!pending) return <div>no-dialog</div>
  return <ReauthDialog authMode="password" user={user} providers={providers} />
}

afterEach(() => {
  if (reauthPending()) resolveReauth(false)
  signInEmail.mockReset()
})

const user: AuthUser = { id: 'u1', email: 'owner@acme.test' }

describe('ReauthDialog (SESSION_NOT_FRESH step-up)', () => {
  it('a pending re-auth request triggers the dialog', async () => {
    render(<Harness user={user} />)
    expect(screen.getByText('no-dialog')).toBeInTheDocument()
    resolveReauthLater()
    expect(await screen.findByRole('heading', { name: "Confirm it's you" })).toBeInTheDocument()
    expect(screen.getByTestId('reauth-password')).toBeInTheDocument()
  })

  it('a successful re-auth closes the dialog and resolves the pending request as reauthenticated', async () => {
    signInEmail.mockResolvedValue({ data: {}, error: null })
    render(<Harness user={user} />)
    const outcome = requestReauth()
    let settled: boolean | null = null
    void outcome.then((v) => {
      settled = v
    })
    await screen.findByRole('heading', { name: "Confirm it's you" })

    fireEvent.change(screen.getByTestId('reauth-password'), { target: { value: 'correct horse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(signInEmail).toHaveBeenCalledWith({ email: 'owner@acme.test', password: 'correct horse' }))
    // Dialog gone (pending cleared) and the coordinator resolved TRUE (the wrapper will retry).
    await waitFor(() => expect(screen.queryByRole('heading', { name: "Confirm it's you" })).not.toBeInTheDocument())
    await waitFor(() => expect(settled).toBe(true))
    expect(reauthPending()).toBe(false)
  })

  it('a wrong password surfaces the error INSIDE the dialog and leaves it open', async () => {
    signInEmail.mockResolvedValue({ data: null, error: { message: 'Invalid email or password.' } })
    render(<Harness user={user} />)
    void requestReauth()
    await screen.findByRole('heading', { name: "Confirm it's you" })

    fireEvent.change(screen.getByTestId('reauth-password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument()
    // Still open, still pending — the user can try again.
    expect(screen.getByRole('heading', { name: "Confirm it's you" })).toBeInTheDocument()
    expect(reauthPending()).toBe(true)
  })
})

// Small helper so the "triggers the dialog" test reads cleanly: fire the request without awaiting it.
function resolveReauthLater() {
  void requestReauth()
}
