import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

const MASQUERADE_OFFLINE_ISOLATION_KEY = `${STORAGE_KEY_PREFIX}masqueradeOfflineIsolation`;
let storageUnavailable = false;
let allowRestorationWrites = false;

/** Mark the offline snapshot as unsafe until a live real-account projection is restored. */
export function markMasqueradeOfflineIsolation(): void {
  allowRestorationWrites = false;
  try {
    localStorage.setItem(MASQUERADE_OFFLINE_ISOLATION_KEY, "on");
    storageUnavailable = false;
  } catch (error) {
    storageUnavailable = true;
    console.warn("offlineCache: masquerade isolation could not be persisted; keeping it fail-closed", error);
  }
}

/** Whether cached identity and tenant data must be withheld while masquerade state is uncertain. */
export function isMasqueradeOfflineIsolated(): boolean {
  if (storageUnavailable) return true;
  try {
    const isolated = localStorage.getItem(MASQUERADE_OFFLINE_ISOLATION_KEY) === "on";
    storageUnavailable = false;
    return isolated;
  } catch (error) {
    console.warn("offlineCache: masquerade isolation could not be read; keeping it fail-closed", error);
    return true;
  }
}

/** Allow cache writes only while the controller loads a server-confirmed real projection. */
export function beginMasqueradeRestorationWrites(): void {
  allowRestorationWrites = true;
}

/** Stop restoration cache writes and optionally finish the isolation after live projection succeeds. */
export function finishMasqueradeRestorationWrites(restored: boolean): void {
  allowRestorationWrites = false;
  if (!restored) return;
  try {
    localStorage.removeItem(MASQUERADE_OFFLINE_ISOLATION_KEY);
    storageUnavailable = false;
  } catch (error) {
    storageUnavailable = true;
    console.warn("offlineCache: masquerade isolation could not be cleared; keeping it fail-closed", error);
  }
}

/** Prevent a member projection from replacing the real principal's offline snapshots. */
export function mayWriteOfflineSnapshot(): boolean {
  return !isMasqueradeOfflineIsolated() || allowRestorationWrites;
}
