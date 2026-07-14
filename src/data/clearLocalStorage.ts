import { STORAGE_KEY_PREFIX } from '@capacitylens/shared/brand'

// The current prefix every device-global preference uses (theme, sidebar, minimiseWeekends, …,
// see lib/displayPrefs.ts). Sourced from the brand module so the prefix is
// defined ONCE (see shared/src/brand.ts). Clearing by this prefix wipes CapacityLens's own state
// WITHOUT touching unrelated origin keys (a shared origin could carry keys from other tools), which
// a blind `localStorage.clear()` would destroy.
export const CAPACITYLENS_KEY_PREFIX = STORAGE_KEY_PREFIX

// Historical Floaty preferences are included so “Clear device data” is complete for upgraded users.
const OWNED_KEY_PREFIXES = [CAPACITYLENS_KEY_PREFIX, 'floaty/'] as const

/**
 * Remove EVERY current `capacitylens/` and legacy `floaty/` key from this browser's localStorage —
 * device-global preferences only. Scheduling data is server-owned (or memory-only in the demo).
 * Used by the Settings “Clear device data” action.
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
    if (key !== null && OWNED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key)
  }
  for (const key of keys) store.removeItem(key)
  return keys.length
}
