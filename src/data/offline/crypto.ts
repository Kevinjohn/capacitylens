import {
  DEVICE_KEY_ID,
  KEY_STORE_NAME,
  WRITE_BOUNDARY_ID,
  OFFLINE_WRITE_BOUNDARY_STORAGE_KEY,
  STORE_NAME,
  MAX_AGE_MS,
} from "./constants";
import { awaitRequest, awaitTx, openOfflineDb } from "./idb";
import { cacheGeneration, advanceCacheGeneration } from "./state";
import type { CachedRecord, EncryptedRecord, WriteBoundary } from "./types";

export function webCrypto(): Crypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto is unavailable; encrypted offline access cannot be enabled.");
  }
  return crypto;
}

async function readDeviceKey(db: IDBDatabase): Promise<CryptoKey | null> {
  const request = db.transaction(KEY_STORE_NAME, "readonly").objectStore(KEY_STORE_NAME).get(DEVICE_KEY_ID);
  const value = (await awaitRequest(request, "The offline encryption key could not be read.")) as
    { id?: unknown; value?: unknown } | undefined;
  const candidate = value?.value as Partial<CryptoKey> | undefined;
  return value?.id === DEVICE_KEY_ID && candidate?.type === "secret" && candidate.algorithm?.name === "AES-GCM"
    ? (candidate as CryptoKey)
    : null;
}

export async function deviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await readDeviceKey(db);
  if (existing) return existing;
  const generated = await webCrypto().subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  try {
    const tx = db.transaction(KEY_STORE_NAME, "readwrite");
    tx.objectStore(KEY_STORE_NAME).add({
      id: DEVICE_KEY_ID,
      value: generated,
    });
    await awaitTx(
      tx,
      "The offline encryption key could not be stored.",
      "The offline encryption key write was aborted.",
    );
    return generated;
  } catch (cause) {
    // Another tab may have won the create race, or this browser may be unable to persist a
    // CryptoKey. Use the persisted winner, never an unrecorded key; otherwise preserve the cause.
    const winner = await readDeviceKey(db);
    if (winner) return winner;
    console.warn("capacitylens: offline encryption key persistence failed", cause);
    throw new Error("The offline encryption key could not be established.", { cause });
  }
}

function storedWriteBoundaryToken(): string | null {
  try {
    return localStorage.getItem(OFFLINE_WRITE_BOUNDARY_STORAGE_KEY);
  } catch (error) {
    console.warn("offlineCache: the offline write boundary could not be read; rejecting cache writes", error);
    return null;
  }
}

function newWriteBoundaryToken(): string {
  try {
    return webCrypto().randomUUID();
  } catch {
    // Cleanup must remain available even if Web Crypto disappears after offline access was enabled.
    // This is an ordering nonce, not a secret; Date + random + the local counter makes accidental
    // equality across browser contexts vanishingly unlikely.
    return `${Date.now()}:${Math.random()}:${cacheGeneration}`;
  }
}

export function advanceWriteBoundary(): {
  token: string;
  storageError: unknown | null;
} {
  advanceCacheGeneration();
  const token = newWriteBoundaryToken();
  try {
    localStorage.setItem(OFFLINE_WRITE_BOUNDARY_STORAGE_KEY, token);
    return { token, storageError: null };
  } catch (error) {
    // The durable IndexedDB token below still rejects every earlier writer. Report the preference
    // storage failure after data cleanup so callers can surface it without sacrificing deletion.
    return { token, storageError: error };
  }
}

async function readDurableWriteBoundary(store: IDBObjectStore): Promise<string | null> {
  const value = (await awaitRequest(store.get(WRITE_BOUNDARY_ID), "The offline write boundary could not be read.")) as
    { id?: unknown; token?: unknown } | undefined;
  return value?.id === WRITE_BOUNDARY_ID && typeof value.token === "string" ? value.token : null;
}

export async function initialiseWriteBoundary(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(KEY_STORE_NAME, "readwrite");
  const store = tx.objectStore(KEY_STORE_NAME);
  const durableToken = await readDurableWriteBoundary(store);
  const token = durableToken ?? storedWriteBoundaryToken() ?? newWriteBoundaryToken();
  if (durableToken === null) store.put({ id: WRITE_BOUNDARY_ID, token });
  await awaitTx(
    tx,
    "The offline write boundary could not be established.",
    "The offline write boundary update was aborted.",
  );
  localStorage.setItem(OFFLINE_WRITE_BOUNDARY_STORAGE_KEY, token);
}

export function associatedData(key: string, savedAt: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${key}:${savedAt}:capacitylens-offline-v1`);
}

export async function writeEncryptedRecord<T>(record: CachedRecord<T>): Promise<void> {
  const writeBoundary: WriteBoundary = {
    generation: cacheGeneration,
    token: storedWriteBoundaryToken(),
  };
  const db = await openOfflineDb();
  try {
    const encryptionKey = await deviceKey(db);
    const iv: Uint8Array<ArrayBuffer> = webCrypto().getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(record.value));
    const ciphertext = await webCrypto().subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: associatedData(record.key, record.savedAt),
        tagLength: 128,
      },
      encryptionKey,
      plaintext,
    );
    const encrypted: EncryptedRecord = {
      key: record.key,
      savedAt: record.savedAt,
      version: 1,
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
      ciphertext,
    };
    if (writeBoundary.generation !== cacheGeneration) return;
    const age = Date.now() - encrypted.savedAt;
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return;
    // Read the durable cross-tab boundary and write the record in one transaction. If cleanup's
    // transaction wins, this sees its new token and refuses the stale write. If this transaction
    // wins, cleanup necessarily runs after it and deletes the record.
    const tx = db.transaction([KEY_STORE_NAME, STORE_NAME], "readwrite");
    const boundaryRequest = tx.objectStore(KEY_STORE_NAME).get(WRITE_BOUNDARY_ID);
    boundaryRequest.onsuccess = () => {
      const value = boundaryRequest.result as { id?: unknown; token?: unknown } | undefined;
      const durableToken = value?.id === WRITE_BOUNDARY_ID && typeof value.token === "string" ? value.token : null;
      if (durableToken === writeBoundary.token) tx.objectStore(STORE_NAME).put(encrypted);
    };
    // The boundary read must reject the write even when the transaction itself still settles.
    const boundaryFailure = new Promise<never>((_, reject) => {
      boundaryRequest.onerror = () =>
        reject(boundaryRequest.error ?? new Error("The offline write boundary could not be read."));
    });
    await Promise.race([
      awaitTx(tx, "The offline cache could not be updated.", "The offline cache update was aborted."),
      boundaryFailure,
    ]);
  } finally {
    db.close();
  }
}
