import { migrateLegacyStorage } from './storageMigration'

// Side-effect entry for the storage-key rebrand migration (P0.0). Importing this module RUNS the
// legacy `floaty/` → `capacitylens/` key copy immediately, as a module side-effect.
//
// WHY A SIDE-EFFECT IMPORT (not a function call in main.tsx): ES imports are evaluated in source
// order BEFORE any module-body code runs, and the Zustand store reads the device prefs (theme, …)
// eagerly when `useStore.ts` is first imported. A plain `migrateLegacyStorage()` call in main.tsx's
// body would therefore run AFTER the store had already read the new (empty) keys. Importing this
// module FIRST in main.tsx guarantees the copy happens before any other module reads storage.
//
// REMOVABLE A RELEASE LATER together with storageMigration.ts (see that file) — once installs have
// migrated, delete this module, its first-line import in main.tsx, and main.tsx's
// `storageMigrationError` recovery branch.

/**
 * Set when the migration COPY failed on a reachable store (e.g. QuotaExceededError from `setItem`):
 * the user's data under the legacy `floaty/` keys was NOT carried forward, so booting normally would
 * read the (empty) new keys and the data would APPEAR lost. main.tsx checks this before bootstrap and
 * routes to the storage-recovery screen instead — mirroring bootstrap's own load-failure branch
 * (render empty, attach NO persistence, run NO seed) so nothing can mask the still-recoverable
 * legacy keys. `undefined` means the migration ran clean (an UNAVAILABLE store is a documented
 * soft-skip inside `migrateLegacyStorage`, not a failure).
 *
 * WHY captured here rather than thrown onward: this module is evaluated as main.tsx's FIRST import,
 * before React mounts — a throw at module scope would kill the whole bundle evaluation and leave a
 * blank page (no ErrorBoundary exists yet), which is exactly the silent failure
 * DEFENSIVE-CODING.md §1 forbids. Capturing lets main.tsx surface it on a real screen.
 */
export let storageMigrationError: unknown

try {
  migrateLegacyStorage()
} catch (e) {
  // Breadcrumb for contributors; the USER-visible surface is main.tsx's loadError → StorageRecovery.
  console.error('runStorageMigration: legacy-key copy failed — legacy data NOT migrated', e)
  storageMigrationError = e
}
