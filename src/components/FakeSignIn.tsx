import avatarUrl from '../assets/avatar-demo.svg'
import { FAKE_USER } from '../lib/fakeAuth'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'

// COSMETIC demo sign-in — a Google-account-chooser look shown BEFORE the account picker so
// a viewer sees the intended "log in first, then pick a company" flow. There is NO real
// authentication and NO popup: clicking an account just flips the device-global
// `fakeSignedIn` flag (via onSignIn) and reveals the picker. The real, server-authoritative
// auth seam is `src/auth/` (AuthProvider / LoginScreen); AppShell only mounts THIS screen
// when that auth is OFF (authMode === 'off'), so the two never double-gate. Restyle the
// persona via `src/lib/fakeAuth.ts` and `src/assets/avatar-demo.svg`.

/** The multi-colour Google "G" mark. Decorative (aria-hidden) and inline so the demo needs
 *  no network request. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

/**
 * The demo sign-in gate.
 *
 * @param onSignIn called when the viewer "signs in" (clicks the account) — the host
 *   (AppShell) flips the device-global flag and advances to the account picker.
 */
export function FakeSignIn({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <div className="flex flex-col items-center gap-2 px-6 pb-5 pt-7 text-center">
            <GoogleMark />
            <h1 className="text-xl font-semibold text-ink">{m.fake_title()}</h1>
            <p className="text-sm text-muted">
              {m.fake_continue_to()}<span className="font-medium text-ink">{APP_NAME}</span>
            </p>
          </div>

          <ul className="border-t border-line-faint">
            <li>
              <button
                type="button"
                data-testid="fake-sign-in"
                onClick={onSignIn}
                className="flex w-full items-center gap-3 px-6 py-3 text-left transition hover:bg-canvas"
              >
                <img src={avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{FAKE_USER.name}</span>
                  <span className="block truncate text-xs text-muted">{FAKE_USER.email}</span>
                </span>
              </button>
            </li>
            <li className="border-t border-line-faint">
              {/* Not a dead control: in the fake, any choice just proceeds to the picker. */}
              <button
                type="button"
                onClick={onSignIn}
                className="flex w-full items-center gap-3 px-6 py-3 text-left text-muted transition hover:bg-canvas"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-muted">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <circle cx="12" cy="8" r="3.2" />
                    <path d="M5.5 19a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="text-sm">{m.fake_use_another()}</span>
              </button>
            </li>
          </ul>
        </div>
      </main>
    </div>
  )
}
