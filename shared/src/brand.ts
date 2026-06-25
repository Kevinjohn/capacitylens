// Single source of truth for the product brand. Both the client (UI wordmarks, page title,
// feedback subject, recovery copy) and the server (backup filenames, log prefixes) import from
// here so the name is defined ONCE and can never drift between the two halves.

/**
 * The product's public display name.
 *
 * INVARIANT: this is the ONLY place the brand string is literal in code. Every user-facing
 * "CapacityLens" (wordmarks, copy, feedback subjects, server log/backup prefixes) reads through this
 * constant — change it here and the whole app/server follows. Do not re-hardcode the name elsewhere.
 * The sole documented exception is `index.html`: it is static HTML served before any module loads,
 * so it cannot import this constant and keeps the brand literal in its <title>/no-JS copy.
 */
export const APP_NAME = 'CapacityLens'

/**
 * The single localStorage/sessionStorage key prefix every key this app writes shares — the AppData
 * blob (`capacitylens/v3`) AND every device-global preference (theme, sidebar, …).
 *
 * INVARIANT: all persisted keys are `${STORAGE_KEY_PREFIX}<name>`. Clearing/iterating by this prefix
 * touches only this app's keys, never unrelated keys on a shared origin. The trailing slash is part
 * of the prefix. The legacy prefix was `floaty/` — see the storage-key migration shim
 * (src/data/storageMigration.ts), which copies legacy keys forward on first read.
 */
export const STORAGE_KEY_PREFIX = 'capacitylens/'
