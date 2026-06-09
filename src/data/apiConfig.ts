// The optional backend's base URL, read once from the build-time env. Unset = local-first
// (localStorage); set = the app persists to the SQLite-backed server via ServerSyncAdapter.
// Trailing slash trimmed so `${API_BASE}/api/...` is clean. Kept in its own module (mirrors
// schedule/diary) so the single env read isn't scattered across the adapter wiring.

export const API_BASE = (import.meta.env.VITE_FLOATY_API ?? '').replace(/\/+$/, '')

/** True when a backend is configured (VITE_FLOATY_API was set at build time). */
export function isServerConfigured(): boolean {
  return API_BASE.length > 0
}
