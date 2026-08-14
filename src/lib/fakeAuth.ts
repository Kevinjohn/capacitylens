import { useAuth } from "../auth/authContext";
import { isDemoMode } from "../data/apiConfig";

// COSMETIC demo identity for the fake sign-in screen (`src/components/FakeSignIn.tsx`)
// and the "Signed in as …" line on the account picker. This is NOT real authentication —
// no account, password, or session exists, and nothing here gates data access. The real,
// server-authoritative auth seam is `src/auth/` (AuthProvider / LoginScreen); the demo
// gate is only active when that auth is OFF. Swap these (and `assets/avatar-demo.svg`) to
// change the face shown on the demo sign-in. See DECISIONS.md → "UI & product".

/** The persona shown on the demo sign-in card and the picker's "Signed in as" line. */
export const FAKE_USER = {
  name: "Jordan Avery",
  email: "jordan.avery@example.com",
} as const;

/** Whether the cosmetic demo sign-in chrome is active — i.e. the real auth seam is OFF
 *  (`authMode === 'off'`). Single source for that predicate so the demo gate, the picker's
 *  "Signed in as" line, and the demo "Sign out" can't drift; when real auth is on, every demo
 *  surface is suppressed and `src/auth/` owns sign-in/out.
 *
 *  In terms of the other demo predicate: this is `accessExperienceFor(authMode) === "demo" &&
 *  authMode === "off"` (see lib/accessMode.ts). It is deliberately the NARROWER of the two —
 *  `accessExperienceFor` answers "what access posture do we describe to the viewer?" and drives
 *  the access copy, whereas this answers only "is the fake sign-in chrome on screen?". A demo
 *  build running WITH real auth on still has a "demo" experience but no demo chrome. */
export function useDemoAuthActive(): boolean {
  const { authMode } = useAuth();
  return isDemoMode() && authMode === "off";
}
