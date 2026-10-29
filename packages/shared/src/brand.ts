/** Shared product display name used by importing UI and server surfaces.
 * Static documents and backend configuration also carry display branding. Backup filenames,
 * retention matching and storage/wire identifiers have independent stable contracts. */
export const APP_NAME = 'CapacityLens';

/**
 * The single localStorage/sessionStorage key prefix every device preference this app writes uses.
 *
 * Invariant: all persisted keys are `${STORAGE_KEY_PREFIX}<name>`. Clearing/iterating by this prefix
 * touches only this app's keys, never unrelated keys on a shared origin. The trailing slash is part
 * of the prefix.
 */
export const STORAGE_KEY_PREFIX = 'capacitylens/';
