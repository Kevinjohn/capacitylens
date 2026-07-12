import { STORAGE_KEY_PREFIX } from '@capacitylens/shared/brand'

// Storage-key rebrand migration (P0.0): the app's localStorage/sessionStorage keys moved from the
// legacy `floaty/` prefix to `capacitylens/` (STORAGE_KEY_PREFIX). This shim copies every legacy key
// forward on first read so existing users keep their persisted data (the `/v3` AppData blob) and
// device prefs (theme, sidebar, …) without manual re-entry.
//
// REMOVABLE A RELEASE LATER: once installs have run at least once post-rebrand, the new keys are
// authoritative and the legacy `floaty/` keys are dead weight — this whole module (and its call in
// main.tsx) can be deleted. Until then it must run BEFORE any key is read.
//
// The legacy `floaty/` literal here is DELIBERATE and must NOT be renamed by the rebrand — it is the
// source side of the copy. It is the only place that literal still appears in app code.

/** The legacy prefix every pre-rebrand key shared. Intentionally hard-coded (not derived from a
 *  constant) because it is historical: the new prefix lives in STORAGE_KEY_PREFIX. */
const LEGACY_KEY_PREFIX = 'floaty/'

/**
 * Copy every legacy-prefixed key in `store` forward to its `capacitylens/` equivalent, but only when
 * the new key is ABSENT — a key already written under the new prefix is authoritative and is never
 * overwritten (so a post-rebrand value can't be clobbered by a stale legacy one). The legacy keys are
 * left in place (harmless; cleaned up when this shim is removed). Returns the number of keys copied.
 *
 * Snapshots the legacy keys first: writing the new keys while iterating `store.key(i)` by live index
 * would re-index the list and skip entries.
 *
 * Does NOT swallow: storage I/O is a guarded boundary, but a thrown SecurityError/QuotaError must
 * surface to the caller (main.tsx) — per DEFENSIVE-CODING.md this is a real failure on the data path
 * (the primary `/v3` blob rides this migration), not a non-tenant device pref we may reset.
 */
export function migrateLegacyStorageKeys(store: Storage): number {
  const legacyKeys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key !== null && key.startsWith(LEGACY_KEY_PREFIX)) legacyKeys.push(key)
  }
  let copied = 0
  for (const legacyKey of legacyKeys) {
    const newKey = STORAGE_KEY_PREFIX + legacyKey.slice(LEGACY_KEY_PREFIX.length)
    if (store.getItem(newKey) !== null) continue // new key already authoritative — never overwrite
    const value = store.getItem(legacyKey)
    if (value === null) continue
    store.setItem(newKey, value)
    copied++
  }
  return copied
}

/**
 * Run the legacy→new key migration across BOTH web storages. Call once, as early as possible (before
 * the store reads the theme, before bootstrap loads the AppData blob).
 *
 * ONLY the store-availability PROBE is guarded — and the probe covers BOTH failure shapes: the
 * accessor itself throwing (SecurityError in a sandboxed/private context) AND an accessor that
 * succeeds but whose READ operations (`length`/`key`/`getItem`) throw (some embedded/permission-
 * denied environments hand back a Storage object that rejects every operation). Either way an
 * unreadable store means there is nothing to migrate FROM it, so we log and move on rather than
 * aborting the other store or crashing boot. This
 * is the documented degrade for a non-tenant storage boundary (DEFENSIVE-CODING.md §5) — no data is
 * lost: the legacy keys stay in place, and a store that can't be read also can't have held
 * recoverable data.
 *
 * The per-key copy is deliberately OUTSIDE the guard: once a store is reachable, a copy failure
 * (e.g. QuotaExceededError from `setItem`) means the user's legacy data was NOT carried forward and
 * the app would boot looking empty — a real data-path failure that must PROPAGATE to the boot path
 * (runStorageMigration.ts routes it to the storage-recovery screen), never be soft-skipped as
 * "store unavailable".
 *
 * @throws whatever {@link migrateLegacyStorageKeys} throws — a throw here means legacy data was NOT
 *         migrated; the caller must surface it, not proceed as if the new keys were authoritative.
 */
export function migrateLegacyStorage(): void {
  const stores: Array<[name: string, get: () => Storage]> = [
    ['localStorage', () => localStorage],
    ['sessionStorage', () => sessionStorage],
  ]
  for (const [name, get] of stores) {
    let store: Storage
    try {
      // Availability probe ONLY — two shapes, both meaning "this store can't be read":
      //  1. the accessor itself throws (classic sandboxed/private-mode SecurityError);
      //  2. the accessor succeeds but the READ operations throw (some environments return a
      //     Storage object whose length/key/getItem all raise SecurityError). Exercising each read
      //     op the migration relies on HERE keeps that shape in the soft-skip arm — otherwise it
      //     would throw inside migrateLegacyStorageKeys below and be misclassified as a COPY
      //     failure (which blocks boot into the recovery screen for data that never existed).
      store = get()
      void store.length
      void store.key(0)
      void store.getItem(LEGACY_KEY_PREFIX)
    } catch (e) {
      console.warn(`migrateLegacyStorage: ${name} unavailable — skipping legacy key migration`, e)
      continue
    }
    // Outside the try: a copy failure (a WRITE, e.g. QuotaExceededError from setItem) on a
    // reachable store surfaces (see doc comment above).
    migrateLegacyStorageKeys(store)
  }
}
