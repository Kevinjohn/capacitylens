import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

export const OFFLINE_PREF_KEY = `${STORAGE_KEY_PREFIX}offlineRead`;
export const DB_NAME = "capacitylens-offline-v1";
export const STORE_NAME = "records";
export const KEY_STORE_NAME = "keys";
export const DEVICE_KEY_ID = "device-aes-gcm-v1";
export const WRITE_BOUNDARY_ID = "write-boundary-v1";
export const OFFLINE_WRITE_BOUNDARY_STORAGE_KEY = `${STORAGE_KEY_PREFIX}offlineWriteBoundary`;
export const SHELL_CACHE_PREFIX = "capacitylens-shell-";
export const SHELL_METADATA_CACHE = "capacitylens-offline-shell-metadata-v1";
export const ACTIVE_SHELL_POINTER = "/__capacitylens-offline/active-shell";
export const OFFLINE_WORKER_URL = "/offline-worker.js";
export const SHELL_ACTIVATION_TIMEOUT_MS = 30_000;
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SLICE_REWRITE_INTERVAL_MS = 5 * 60 * 1000;
export const CACHED_SLICE_KEYS = ["accounts", ...SCOPED_KEYS] as const;
