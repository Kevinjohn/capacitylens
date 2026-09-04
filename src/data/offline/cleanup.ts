import { KEY_STORE_NAME, STORE_NAME, WRITE_BOUNDARY_ID } from "./constants";
import { scope, recentSliceWrites, resetOfflineState } from "./state";
import { openOfflineDb, awaitTx } from "./idb";
import { advanceWriteBoundary } from "./crypto";
import { authKey, scopedKey } from "./keys";

/** Shared cleanup shell. Both paths advance the write boundary BEFORE opening the database, run
 * exactly one keys+records transaction, always drop page-local state, and report a
 * preference-storage failure last so a deletion is never sacrificed to it. `mutate` may return a
 * promise that rejects on a request-level failure alongside the transaction's own outcome.
 * A user-scoped sign-out must TELL its caller when no records could be removed; the device-wide
 * wipe has nothing left to promise, so it returns instead — hence the explicit parameter. */
async function clearOfflineRecords(
  onMissingIndexedDb: "throw" | "return",
  mutate: (tx: IDBTransaction, boundaryToken: string) => Promise<never> | void,
  afterCommit: () => void,
): Promise<void> {
  const boundary = advanceWriteBoundary();
  if (typeof indexedDB === "undefined") {
    resetOfflineState();
    if (boundary.storageError) throw boundary.storageError;
    // The caller must know that no durable records were removed. Sign-out uses this rejection to
    // remove the offline opt-in, so records left behind while browser storage is unavailable can
    // never be accepted on a later networkless boot.
    if (onMissingIndexedDb === "throw") throw new Error("IndexedDB is unavailable on this device.");
    return;
  }
  const db = await openOfflineDb();
  try {
    const tx = db.transaction([KEY_STORE_NAME, STORE_NAME], "readwrite");
    const requestFailure = mutate(tx, boundary.token);
    const committed = awaitTx(tx, "The offline cache could not be cleared.", "The offline cache clear was aborted.");
    await (requestFailure ? Promise.race([committed, requestFailure]) : committed);
  } finally {
    db.close();
    resetOfflineState();
  }
  afterCommit();
  if (boundary.storageError) throw boundary.storageError;
}

/** Remove this user's cached identity, account list and slices. Called before every sign-out. */
export async function clearOfflineDataForCurrentUser(): Promise<void> {
  const currentScope = scope;
  return clearOfflineRecords(
    "throw",
    (tx, boundaryToken) => {
      tx.objectStore(KEY_STORE_NAME).put({
        id: WRITE_BOUNDARY_ID,
        token: boundaryToken,
      });
      const store = tx.objectStore(STORE_NAME);
      // Sign-out only inspects and deletes keys. A key cursor avoids deserialising every other
      // user's encrypted payload while the session-ending path walks this shared object store.
      const request = store.openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const key = String(cursor.key);
        const accountsKey = currentScope ? scopedKey("accounts", "", currentScope) : null;
        const slicePrefix = currentScope ? scopedKey("slice", ":", currentScope) : null;
        if (key === authKey() || key === accountsKey || (slicePrefix && key.startsWith(slicePrefix)))
          store.delete(cursor.key);
        cursor.continue();
      };
      return new Promise<never>((_, reject) => {
        request.onerror = () => reject(request.error ?? new Error("The offline cache could not be cleared."));
      });
    },
    () => {
      const recent = recentSliceWrites.get(indexedDB);
      if (currentScope && recent) {
        const accountsKey = scopedKey("accounts", "", currentScope);
        const slicePrefix = scopedKey("slice", ":", currentScope);
        for (const key of recent.keys()) if (key === accountsKey || key.startsWith(slicePrefix)) recent.delete(key);
      }
    },
  );
}

/** Remove every CapacityLens offline identity and account snapshot from this browser profile.
 * Used only by the explicit “Clear device data” action; normal sign-out remains user-scoped. */
export async function clearAllOfflineData(): Promise<void> {
  return clearOfflineRecords(
    "return",
    (tx, boundaryToken) => {
      // “Clear device data” is the recovery boundary for corrupt or incompatible CryptoKey
      // structured clones too. Remove every key-store entry, then restore only the generation
      // token that prevents writes started before this wipe from repopulating the records store.
      const keyStore = tx.objectStore(KEY_STORE_NAME);
      keyStore.clear();
      keyStore.put({ id: WRITE_BOUNDARY_ID, token: boundaryToken });
      tx.objectStore(STORE_NAME).clear();
    },
    () => recentSliceWrites.get(indexedDB)?.clear(),
  );
}
