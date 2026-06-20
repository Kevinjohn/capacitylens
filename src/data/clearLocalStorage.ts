// The single prefix every key this app writes to localStorage shares — the AppData blob
// (`floaty/v3`, see storageAdapter.ts) AND every device-global preference (theme, sidebar,
// placeholdersEnabled, externalEnabled, …, see lib/displayPrefs.ts). Clearing by this prefix
// wipes Floaty's own state WITHOUT touching unrelated origin keys (a shared origin could carry
// keys from other tools), which a blind `localStorage.clear()` would destroy.
export const FLOATY_KEY_PREFIX = 'floaty/'

/**
 * Remove EVERY `floaty/`-prefixed key from this browser's localStorage — the persisted AppData
 * and all device-global preferences. Used by the Settings "Clear local storage" action.
 *
 * Does NOT swallow: this is a user-triggered, destructive action, so a thrown SecurityError /
 * QuotaError (storage disabled, private mode) must surface to the caller for a visible notice —
 * per DEFENSIVE-CODING.md (§1, storage I/O is a guarded boundary, but the surface is the caller).
 *
 * Snapshots the keys first (removing while iterating `localStorage.key(i)` by live index would
 * skip entries as the list re-indexes). Returns the number of keys removed.
 *
 * @throws if reading or removing from localStorage throws (storage unavailable) — the caller
 *   surfaces it; clearing is all-or-nothing only up to the failing key.
 */
export function clearFloatyLocalStorage(store: Storage = localStorage): number {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key !== null && key.startsWith(FLOATY_KEY_PREFIX)) keys.push(key)
  }
  for (const key of keys) store.removeItem(key)
  return keys.length
}
