import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

// Match only the application prefix so clearing device data preserves other tools on a shared origin.
/** Prefix used to identify application-owned browser storage keys. */
export const CAPACITYLENS_KEY_PREFIX = STORAGE_KEY_PREFIX;

interface OwnedLocalStorageEntry {
  key: string;
  value: string;
}

function listOwnedLocalStorageKeys(store: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key !== null && key.startsWith(CAPACITYLENS_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

/** Read app-owned values without parsing them, so corrupt bytes can still be downloaded intact. */
export function readCapacitylensLocalStorage(store: Storage = localStorage): OwnedLocalStorageEntry[] {
  return listOwnedLocalStorageKeys(store).map((key) => ({
    key,
    value: store.getItem(key) ?? "",
  }));
}

/** Removes application-prefixed localStorage keys and returns the number removed.
 * Scheduling data is server-owned or memory-only in demo mode. Keys are snapshotted
 * before deletion because live indexes change after each removal.
 * @throws When storage access fails; earlier removals are not rolled back.
 */
export function clearCapacitylensLocalStorage(store: Storage = localStorage): number {
  const keys = listOwnedLocalStorageKeys(store);
  for (const key of keys) store.removeItem(key);
  return keys.length;
}
