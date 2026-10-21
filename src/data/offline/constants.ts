import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

/** Local-storage key for the opt-in offline-read preference. */
export const OFFLINE_PREF_KEY = `${STORAGE_KEY_PREFIX}offlineRead`;
/** IndexedDB database name for the encrypted offline cache. */
export const DB_NAME = "capacitylens-offline-v1";
/** IndexedDB object-store name for encrypted cached records. */
export const STORE_NAME = "records";
/** IndexedDB object-store name for encryption metadata. */
export const KEY_STORE_NAME = "keys";
/** IndexedDB key identifier for the device encryption key. */
export const DEVICE_KEY_ID = "device-aes-gcm-v1";
/** IndexedDB key identifier for the durable cache-write boundary. */
export const WRITE_BOUNDARY_ID = "write-boundary-v1";
/** Local-storage key for the current cache-write boundary token. */
export const OFFLINE_WRITE_BOUNDARY_STORAGE_KEY = `${STORAGE_KEY_PREFIX}offlineWriteBoundary`;
/** Cache Storage prefix for offline application shell versions. */
export const SHELL_CACHE_PREFIX = "capacitylens-shell-";
/** Cache Storage name for offline-shell metadata. */
export const SHELL_METADATA_CACHE = "capacitylens-offline-shell-metadata-v1";
/** Cache URL that points to the active offline shell. */
export const ACTIVE_SHELL_POINTER = "/__capacitylens-offline/active-shell";
/** Service-worker URL used for offline shell support. */
export const OFFLINE_WORKER_URL = "/offline-worker.js";
/** Maximum wait for an offline shell activation handshake. */
export const SHELL_ACTIVATION_TIMEOUT_MS = 30_000;
/** Maximum age of a cached offline snapshot. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Minimum interval between writes of an unchanged account slice. */
export const SLICE_REWRITE_INTERVAL_MS = 5 * 60 * 1000;
/** Data tables included in an encrypted cached account slice. */
export const CACHED_SLICE_KEYS = ["accounts", ...SCOPED_KEYS] as const;
