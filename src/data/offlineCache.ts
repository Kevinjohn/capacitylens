import type { AppData } from "@capacitylens/shared/types/entities";
import { validateAccountSlice } from "./validateAccountSlice";
import { KEY_STORE_NAME, STORE_NAME, WRITE_BOUNDARY_ID } from "./offline/constants";
import { scope, setOfflineScope, recentSliceWrites, resetOfflineState, sliceRewriteGate } from "./offline/state";
import { originKey, openOfflineDb, awaitTx } from "./offline/idb";
import { advanceWriteBoundary } from "./offline/crypto";
import { cachedRecord, validateAuthSnapshot, validateAccountSummaries } from "./offline/records";
import type {
  CachedRecord,
  OfflineAuthSnapshot,
  OfflineAccountSummary,
  OfflineCacheWriteResult,
} from "./offline/types";

export { OFFLINE_WRITE_BOUNDARY_STORAGE_KEY } from "./offline/constants";
export type { OfflineAuthSnapshot } from "./offline/types";
export {
  offlineReadEnabled,
  subscribeOfflinePreference,
  setOfflineReadState,
  offlineStateEpisode,
  offlineStateSnapshot,
  subscribeOfflineState,
} from "./offline/state";
export { offlineShellAvailable, revalidateOfflineShell, setOfflineReadEnabled } from "./offline/shell";

function authKey(): string {
  return `auth:${originKey()}`;
}

/** Build a user-scoped cache key. Cleanup passes the scope it captured before the boundary advance
 * instead of rebuilding the same strings inline. */
function scopedKey(kind: "accounts" | "slice", suffix = "", forScope = scope): string {
  if (!forScope) throw new Error("Offline cache scope is unavailable until a user has been verified.");
  return `${kind}:${forScope.origin}:${forScope.userId}${suffix}`;
}

const authSnapshotCache = cachedRecord<OfflineAuthSnapshot>(authKey, validateAuthSnapshot, {
  readNeedsScope: false,
});
const accountSummariesCache = cachedRecord<OfflineAccountSummary[]>(
  () => scopedKey("accounts"),
  validateAccountSummaries,
);
const accountSliceCache = cachedRecord<AppData, [accountId: string]>(
  (accountId) => scopedKey("slice", `:${accountId}`),
  (value, accountId) => validateAccountSlice(value, accountId),
  { gate: sliceRewriteGate },
);

/** Persist the last verified identity and make it the cache scope for this page. */
export async function cacheAuthSnapshot(snapshot: OfflineAuthSnapshot): Promise<OfflineCacheWriteResult> {
  setOfflineScope({ origin: originKey(), userId: snapshot.user.id });
  return authSnapshotCache.write(snapshot);
}

/** Restore the last verified identity for an offline boot. Never fabricates a session. */
export async function readCachedAuthSnapshot(
  opts: { acceptEffects?: () => boolean } = {},
): Promise<CachedRecord<OfflineAuthSnapshot> | null> {
  const record = await authSnapshotCache.read();
  if (record && (opts.acceptEffects?.() ?? true)) {
    // A cache miss is evidence only about durable cache state. It must not revoke a scope that a
    // concurrent successful live /me already established through cacheAuthSnapshot; explicit
    // sign-out/device cleanup owns scope removal. A cached hit may still establish cold-boot scope.
    setOfflineScope({ origin: originKey(), userId: record.value.user.id });
  }
  return record;
}

export async function cacheAccountSummaries(summaries: OfflineAccountSummary[]): Promise<OfflineCacheWriteResult> {
  return accountSummariesCache.write(summaries);
}

export async function readCachedAccountSummaries(): Promise<CachedRecord<OfflineAccountSummary[]> | null> {
  return accountSummariesCache.read();
}

export async function cacheAccountSlice(accountId: string, data: AppData): Promise<OfflineCacheWriteResult> {
  return accountSliceCache.write(data, accountId);
}

export async function readCachedAccountSlice(accountId: string): Promise<CachedRecord<AppData> | null> {
  return accountSliceCache.read(accountId);
}

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
