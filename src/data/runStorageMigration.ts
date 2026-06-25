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
// migrated, delete this module and its first-line import in main.tsx.
migrateLegacyStorage()
