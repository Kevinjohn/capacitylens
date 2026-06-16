// COSMETIC demo identity for the fake sign-in screen (`src/components/FakeSignIn.tsx`)
// and the "Signed in as …" line on the account picker. This is NOT real authentication —
// no account, password, or session exists, and nothing here gates data access. The real,
// server-authoritative auth seam is `src/auth/` (AuthProvider / LoginScreen); the demo
// gate is only active when that auth is OFF. Swap these (and `assets/avatar-demo.svg`) to
// change the face shown on the demo sign-in. See DECISIONS.md → "UI & product".

/** The persona shown on the demo sign-in card and the picker's "Signed in as" line. */
export const FAKE_USER = {
  name: 'Jordan Avery',
  email: 'jordan.avery@example.com',
} as const
