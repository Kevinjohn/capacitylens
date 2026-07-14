// The backend's base URL, read once from the build-time env. Empty (the default) now means the
// SAME-ORIGIN server (relative `/api`), NOT "local" — server persistence is the default. Set it to
// point at a different origin (e.g. http://localhost:8787). The zero-setup browser demo is an
// explicit opt-in (VITE_CAPACITYLENS_DEMO=1) and keeps its editable seed in memory only. Trailing slash
// trimmed so `${API_BASE}/api/...` is clean. Kept in its own module (mirrors schedule/diary) so the
// single env read isn't scattered across the adapter wiring.

export const API_BASE = (import.meta.env.VITE_CAPACITYLENS_API ?? '').replace(/\/+$/, '')

/** Demo mode: an editable, in-memory seed that resets on refresh.
 *  NOTE: this is the persistence demo — distinct from the cosmetic auth persona
 *  (the cosmetic fake sign-in: `useDemoAuthActive`/`FakeSignIn`/`fakeAuth.ts`, keyed off authMode 'off'). */
export function isDemoMode(): boolean {
  return import.meta.env.VITE_CAPACITYLENS_DEMO === '1'
}

/** Server mode is now the DEFAULT — true unless the demo flag is set, regardless of API_BASE
 *  (empty API_BASE = same-origin server, not "local"). Name kept so the ~15 call sites read unchanged. */
export function isServerConfigured(): boolean {
  return !isDemoMode()
}
