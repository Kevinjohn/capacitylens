// The backend's base URL, read once from the build-time env. Empty (the default) now means the
// SAME-ORIGIN server (relative `/api`), NOT "local" — server persistence is the default. Set it to
// point at a different origin (e.g. http://localhost:8787). The in-browser localStorage build is now
// an explicit DEMO opt-in (VITE_CAPACITYLENS_DEMO=1) — the only route to localStorage. Trailing slash
// trimmed so `${API_BASE}/api/...` is clean. Kept in its own module (mirrors schedule/diary) so the
// single env read isn't scattered across the adapter wiring.

export const API_BASE = (import.meta.env.VITE_CAPACITYLENS_API ?? '').replace(/\/+$/, '')

/** Demo mode: the in-browser localStorage build (the old default). The ONLY route to localStorage now.
 *  NOTE: this is the PERSISTENCE demo (localStorage build) — distinct from the UNRELATED auth "demo"
 *  (the cosmetic fake sign-in: `useDemoAuthActive`/`FakeSignIn`/`fakeAuth.ts`, keyed off authMode 'off'). */
export function isDemoMode(): boolean {
  return import.meta.env.VITE_CAPACITYLENS_DEMO === '1'
}

/** Server mode is now the DEFAULT — true unless the demo flag is set, regardless of API_BASE
 *  (empty API_BASE = same-origin server, not "local"). Name kept so the ~15 call sites read unchanged. */
export function isServerConfigured(): boolean {
  return !isDemoMode()
}
