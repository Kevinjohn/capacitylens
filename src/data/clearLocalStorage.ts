import { STORAGE_KEY_PREFIX } from '@capacitylens/shared/brand'

// The single prefix every key this app writes to localStorage shares — the AppData blob
// (`capacitylens/v3`, see storageAdapter.ts) AND every device-global preference (theme, sidebar,
// minimiseWeekends, …, see lib/displayPrefs.ts). Sourced from the brand module so the prefix is
// defined ONCE (see shared/src/brand.ts). Clearing by this prefix wipes CapacityLens's own state
// WITHOUT touching unrelated origin keys (a shared origin could carry keys from other tools), which
// a blind `localStorage.clear()` would destroy.
export const CAPACITYLENS_KEY_PREFIX = STORAGE_KEY_PREFIX

/**
 * Remove EVERY `capacitylens/`-prefixed key from this browser's localStorage — the persisted AppData
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
export function clearCapacitylensLocalStorage(store: Storage = localStorage): number {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key !== null && key.startsWith(CAPACITYLENS_KEY_PREFIX)) keys.push(key)
  }
  for (const key of keys) store.removeItem(key)
  return keys.length
}
