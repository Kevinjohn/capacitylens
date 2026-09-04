import { API_BASE } from "../apiConfig";
import { DB_NAME, STORE_NAME, KEY_STORE_NAME, MAX_AGE_MS } from "./constants";

export function originKey(): string {
  const frontendOrigin = typeof window === "undefined" ? "server" : window.location.origin;
  if (API_BASE.length === 0) return `${frontendOrigin}|api:${frontendOrigin}`;
  try {
    const resolutionBase = frontendOrigin === "server" ? "http://capacitylens.invalid" : frontendOrigin;
    return `${frontendOrigin}|api:${new URL(API_BASE, resolutionBase).origin}`;
  } catch {
    // Invalid build-time URLs already make live requests unusable. Keep their offline namespace
    // isolated by the exact configured value rather than falling back to another backend's data.
    return `${frontendOrigin}|api:invalid:${encodeURIComponent(API_BASE)}`;
  }
}

/** Settle when a transaction reaches a terminal state. Each caller keeps its own wording, so both
 * failure messages are passed in rather than derived from one shared subject. */
export function awaitTx(tx: IDBTransaction, errorMessage: string, abortMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(errorMessage));
    tx.onabort = () => reject(tx.error ?? new Error(abortMessage));
  });
}

/** Settle on a single request. No abort handler: an aborted transaction fires the request's own
 * error event, so these read paths reject exactly as they did with a hand-written promise. */
export function awaitRequest<T>(request: IDBRequest<T>, failureMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(failureMessage));
  });
}

export function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable on this device."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 2);
    let settled = false;
    const rejectOpen = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = (event) => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(KEY_STORE_NAME)) {
        request.result.createObjectStore(KEY_STORE_NAME, { keyPath: "id" });
      }
      // Version 1 stored plaintext values. Never carry them across the encrypted-cache upgrade.
      if (event.oldVersion < 2 && request.result.objectStoreNames.contains(STORE_NAME)) {
        request.transaction?.objectStore(STORE_NAME).clear();
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      // A blocked version change can later succeed after the stale tab closes. The caller already
      // received the actionable rejection, so close that late connection instead of leaking it.
      if (settled) {
        db.close();
        return;
      }
      void sweepExpiredRecords(db).then(
        () => {
          if (settled) {
            db.close();
            return;
          }
          settled = true;
          resolve(db);
        },
        (error: unknown) => {
          db.close();
          rejectOpen(error instanceof Error ? error : new Error(String(error)));
        },
      );
    };
    request.onerror = () => rejectOpen(request.error ?? new Error("The offline cache could not be opened."));
    request.onblocked = () =>
      rejectOpen(
        new Error("The offline cache upgrade is blocked by another open tab. Close or reload it and try again."),
      );
  });
}

/** Physically enforce the retention boundary whenever this page next touches the cache. Browsers
 * cannot run application JavaScript while the site is closed, so open/write maintenance is the
 * earliest reliable cleanup point after seven days have elapsed. */
function sweepExpiredRecords(db: IDBDatabase): Promise<void> {
  const now = Date.now();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const request = tx.objectStore(STORE_NAME).openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const savedAt = (cursor.value as { savedAt?: unknown } | undefined)?.savedAt;
    const age = typeof savedAt === "number" ? now - savedAt : Number.NaN;
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) cursor.delete();
    cursor.continue();
  };
  // The cursor's own failure rejects the sweep even when the transaction itself still settles.
  const inspected = new Promise<never>((_, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Expired offline data could not be inspected."));
  });
  return Promise.race([
    awaitTx(tx, "Expired offline data could not be removed.", "Offline retention cleanup was aborted."),
    inspected,
  ]);
}
