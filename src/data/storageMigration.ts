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
 *  constant) because it is historical: the new prefix lives in STORAGE_KEY_PREFIX. Exported so the
 *  recovery path (StorageRecovery via {@link removeLegacyKeys}) shares the ONE definition rather
 *  than a second hard-coded copy. */
export const LEGACY_KEY_PREFIX = 'floaty/'

/** The legacy PRIMARY AppData blob key — the pre-rebrand twin of `capacitylens/v3` (STORAGE_KEY in
 *  storageAdapter.ts; the `v3` suffix mirrors it deliberately). This is the one key whose copy
 *  failure is FATAL to the migration — in LOCALSTORAGE only, the sole store the app ever persisted
 *  the tenant blob to: there it carries the tenant data, unlike the device-pref keys. The same key
 *  name in sessionStorage can only be a stray value and degrades like a pref. */
export const LEGACY_STORAGE_KEY = `${LEGACY_KEY_PREFIX}v3`

/**
 * Copy every legacy-prefixed key in `store` forward to its `capacitylens/` equivalent, but only when
 * the new key is ABSENT — a key already written under the new prefix is authoritative and is never
 * overwritten (so a post-rebrand value can't be clobbered by a stale legacy one). The legacy keys are
 * left in place (harmless; cleaned up when this shim is removed). Returns the number of keys copied.
 *
 * Snapshots the legacy keys first: writing the new keys while iterating `store.key(i)` by live index
 * would re-index the list and skip entries.
 *
 * Failure severity is PER KEY, matching what each key holds:
 *   • the PRIMARY blob ({@link LEGACY_STORAGE_KEY} → `capacitylens/v3`) is tenant data on the data
 *     path — a copy failure (SecurityError/QuotaError) PROPAGATES to the caller (main.tsx routes it
 *     to the storage-recovery screen); anything else would boot the app looking empty. This applies
 *     only when `primaryBlobFatal` is true (the default): the app only ever persisted its tenant
 *     blob in LOCALSTORAGE, so the sessionStorage caller passes false — a stray sessionStorage
 *     `floaty/v3` (never written by this app) is treated as one more device-key degrade, not a
 *     boot blocker.
 *   • every OTHER legacy key is a device-global, non-tenant preference (theme, utilizationPrefs,
 *     sidebar, intro-seen, …) — a copy failure is the documented degrade (DEFENSIVE-CODING.md §5):
 *     `console.warn` breadcrumb, skip the key, keep going. Losing a view toggle must never block
 *     boot or hide a successfully-migrated data blob behind the recovery screen.
 *
 * @param primaryBlobFatal whether a failed copy of {@link LEGACY_STORAGE_KEY} propagates. True for
 *        localStorage (where the tenant blob actually lived); false for sessionStorage, where the
 *        same key name can only be a stray non-tenant value.
 * @throws only for a failed PRIMARY-blob copy when `primaryBlobFatal` — a throw here means the
 *         tenant data was NOT carried forward; the caller must surface it, not proceed as if the
 *         new keys were authoritative.
 */
export function migrateLegacyStorageKeys(store: Storage, primaryBlobFatal = true): number {
  const legacyKeys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key !== null && key.startsWith(LEGACY_KEY_PREFIX)) legacyKeys.push(key)
  }
  let copied = 0
  for (const legacyKey of legacyKeys) {
    const newKey = STORAGE_KEY_PREFIX + legacyKey.slice(LEGACY_KEY_PREFIX.length)
    try {
      if (store.getItem(newKey) !== null) continue // new key already authoritative — never overwrite
      const value = store.getItem(legacyKey)
      if (value === null) continue
      store.setItem(newKey, value)
      copied++
    } catch (e) {
      // Two-tier severity — see the doc comment: the primary blob is fatal (where it can actually
      // hold tenant data — localStorage), a pref (or a stray sessionStorage blob) degrades.
      if (primaryBlobFatal && legacyKey === LEGACY_STORAGE_KEY) throw e
      console.warn(
        `migrateLegacyStorageKeys: copying non-tenant key "${legacyKey}" failed — skipping (§5 degrade)`,
        e,
      )
    }
  }
  return copied
}

/**
 * The raw legacy AppData blob (`floaty/v3`), for the storage-recovery screen's "Download raw"
 * fallback: when the migration's primary-blob copy failed, `capacitylens/v3` was never written, so
 * the only salvageable bytes still live under the LEGACY key. Returns null when nothing is stored
 * or storage is unreadable — mirrors LocalStorageAdapter.readRaw (the caller distinguishes "nothing
 * to save" from a real payload).
 */
export function readLegacyRaw(): string | null {
  try {
    return localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Remove EVERY legacy `floaty/`-prefixed key from both web storages — the storage-recovery screen's
 * "Reset" must call this alongside clearing `capacitylens/v3`: leaving the legacy keys in place
 * would let the next boot's migration re-copy the same unreadable blob forward and land straight
 * back on the recovery screen (the resurrect/re-loop dead end).
 *
 * Swallows storage errors per store (with a `console.warn` breadcrumb) for the same reason
 * LocalStorageAdapter.clear does: reset always reloads, and a store that refuses removeItem would
 * refuse the re-copy's setItem too, so the loop still breaks. Snapshots keys before removing
 * (removing while iterating `key(i)` by live index skips entries).
 */
export function removeLegacyKeys(): void {
  for (const [name, get] of [
    ['localStorage', () => localStorage],
    ['sessionStorage', () => sessionStorage],
  ] as Array<[string, () => Storage]>) {
    try {
      const store = get()
      const legacyKeys: string[] = []
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)
        if (key !== null && key.startsWith(LEGACY_KEY_PREFIX)) legacyKeys.push(key)
      }
      for (const key of legacyKeys) store.removeItem(key)
    } catch (e) {
      console.warn(`removeLegacyKeys: ${name} unavailable — nothing to remove from it`, e)
    }
  }
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
 * The per-key copy is deliberately OUTSIDE the guard: once a store is reachable, a failed copy of
 * the PRIMARY `/v3` blob (e.g. QuotaExceededError from `setItem`) IN LOCALSTORAGE means the user's
 * tenant data was NOT carried forward and the app would boot looking empty — a real data-path
 * failure that must PROPAGATE to the boot path (runStorageMigration.ts routes it to the
 * storage-recovery screen), never be soft-skipped as "store unavailable". localStorage is the ONLY
 * store where that key ever held tenant data (storageAdapter.ts has always persisted the AppData
 * blob there), so sessionStorage runs with `primaryBlobFatal: false`: a stray sessionStorage
 * `floaty/v3` failing to copy is the same §5 degrade as any device pref — warn + skip, never a
 * boot-blocking recovery screen over a key the app never wrote. A failed copy of any OTHER legacy
 * key likewise degrades inside {@link migrateLegacyStorageKeys} (warn + skip, §5) — it never
 * reaches here.
 *
 * @throws whatever {@link migrateLegacyStorageKeys} throws — i.e. only a failed PRIMARY-blob copy
 *         in LOCALSTORAGE; a throw here means tenant data was NOT migrated and the caller must
 *         surface it, not proceed as if the new keys were authoritative.
 */
export function migrateLegacyStorage(): void {
  // primaryBlobFatal marks the one store whose `floaty/v3` can actually hold tenant data.
  const stores: Array<[name: string, get: () => Storage, primaryBlobFatal: boolean]> = [
    ['localStorage', () => localStorage, true],
    ['sessionStorage', () => sessionStorage, false],
  ]
  for (const [name, get, primaryBlobFatal] of stores) {
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
    // Outside the try: a PRIMARY-blob copy failure (a WRITE, e.g. QuotaExceededError from setItem)
    // on reachable LOCALSTORAGE surfaces; sessionStorage's copy failures and pref-key copy failures
    // already degraded inside the helper (see both doc comments above).
    migrateLegacyStorageKeys(store, primaryBlobFatal)
  }
}
