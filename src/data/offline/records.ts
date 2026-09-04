import { isAccountRole } from "@capacitylens/shared/account/types";
import { validateAuthUser } from "../../auth/validateAuthUser";
import { isRecord } from "../validateAccountSlice";
import { STORE_NAME, MAX_AGE_MS } from "./constants";
import { awaitRequest, awaitTx, openOfflineDb } from "./idb";
import { deviceKey, webCrypto, associatedData, writeEncryptedRecord } from "./crypto";
import { pendingWrites, setOfflineCacheWriteFailed, scope, offlineReadEnabled } from "./state";
import type { CachedRecord, OfflineAuthSnapshot, OfflineAccountSummary, OfflineCacheWriteResult } from "./types";
/** Keep same-key writes in acceptance order even when key lookup or encryption settles out of
 * order. Different cache records remain independent, and a rejected write does not poison the
 * queue for a later live value. */
async function put<T>(record: CachedRecord<T>): Promise<void> {
  const previous = pendingWrites.get(record.key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => writeEncryptedRecord(record));
  pendingWrites.set(record.key, current);
  try {
    await current;
    setOfflineCacheWriteFailed(false);
  } catch (error) {
    setOfflineCacheWriteFailed(true);
    throw error;
  } finally {
    if (pendingWrites.get(record.key) === current) pendingWrites.delete(record.key);
  }
}

async function get<T>(key: string): Promise<CachedRecord<T> | null> {
  const db = await openOfflineDb();
  try {
    const record: unknown = await awaitRequest(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
      "The offline cache could not be read.",
    );
    if (!record) return null;
    if (!isRecord(record)) {
      await deleteKey(key);
      return null;
    }
    const savedAt = record.savedAt;
    const age = typeof savedAt === "number" ? Date.now() - savedAt : Number.NaN;
    if (
      record.key === key &&
      typeof savedAt === "number" &&
      Number.isFinite(savedAt) &&
      age >= 0 &&
      age <= MAX_AGE_MS &&
      record.version === 1 &&
      isArrayBuffer(record.iv) &&
      isArrayBuffer(record.ciphertext)
    ) {
      try {
        const encryptionKey = await deviceKey(db);
        const plaintext = await webCrypto().subtle.decrypt(
          {
            name: "AES-GCM",
            iv: record.iv,
            additionalData: associatedData(key, savedAt),
            tagLength: 128,
          },
          encryptionKey,
          record.ciphertext,
        );
        return {
          key,
          savedAt,
          value: JSON.parse(new TextDecoder().decode(plaintext)) as T,
        };
      } catch (error) {
        console.warn("offlineCache: encrypted cache authentication failed; deleting the entry", error);
      }
    }
    await deleteKey(key);
    return null;
  } finally {
    db.close();
  }
}

/** IndexedDB may deserialize an ArrayBuffer in a different JavaScript realm (notably in tests and
 * embedded webviews), where `instanceof ArrayBuffer` is false despite the value having genuine
 * ArrayBuffer internal slots. The brand check still excludes SharedArrayBuffer and plain objects;
 * Web Crypto remains the final strict BufferSource validator. */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

async function getValidated<T>(key: string, validate: (value: unknown) => T | null): Promise<CachedRecord<T> | null> {
  const record = await get<unknown>(key);
  if (!record) return null;
  const value = validate(record.value);
  if (value === null) {
    await deleteKey(key);
    return null;
  }
  return { key: record.key, savedAt: record.savedAt, value };
}

export function validateAuthSnapshot(value: unknown): OfflineAuthSnapshot | null {
  if (!isRecord(value) || !["off", "password", "sso"].includes(String(value.authMode))) return null;
  if (!validateAuthUser(value.user, value.authMode !== "off")) return null;
  if (typeof value.canCreateAccount !== "boolean" || typeof value.multiAccount !== "boolean") return null;
  return value as unknown as OfflineAuthSnapshot;
}

export function validateAccountSummaries(value: unknown): OfflineAccountSummary[] | null {
  if (!Array.isArray(value)) return null;
  for (const row of value) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      typeof row.name !== "string" ||
      !isAccountRole(row.role)
    )
      return null;
  }
  return value as OfflineAccountSummary[];
}

async function deleteKey(key: string): Promise<void> {
  const db = await openOfflineDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    await awaitTx(tx, "The offline cache entry could not be removed.", "Offline cache entry deletion was aborted.");
  } finally {
    db.close();
  }
}

/** One cached record kind: the shared enable/scope guards and write envelope, plus the validated
 * read. `keyFor` and `validate` receive the public wrapper's own arguments, so a scoped key and a
 * per-account validation stay with the caller and every exported signature is unchanged. */
export function cachedRecord<T, A extends unknown[] = []>(
  keyFor: (...args: A) => string,
  validate: (value: unknown, ...args: A) => T | null,
  options: {
    /** Reads that require a verified scope. The identity snapshot deliberately does not: a cold
     * offline boot reads it BEFORE any scope exists. */
    readNeedsScope?: boolean;
    /** Runs after the guards with the key and envelope timestamp. Returns either a skip result
     * declining the write, or a callback to run once the write has landed. */
    gate?: (key: string, value: T, savedAt: number) => OfflineCacheWriteResult | (() => void);
  } = {},
) {
  const { readNeedsScope = true, gate } = options;
  return {
    async write(value: T, ...args: A): Promise<OfflineCacheWriteResult> {
      if (!offlineReadEnabled()) return { status: "skipped", reason: "disabled" };
      if (!scope) return { status: "skipped", reason: "unscoped" };
      const key = keyFor(...args);
      const savedAt = Date.now();
      const written = gate?.(key, value, savedAt);
      if (written && typeof written !== "function") return written;
      await put({ key, savedAt, value });
      written?.();
      return { status: "written" };
    },
    async read(...args: A): Promise<CachedRecord<T> | null> {
      if (!offlineReadEnabled() || (readNeedsScope && !scope)) return null;
      return getValidated(keyFor(...args), (value) => validate(value, ...args));
    },
  };
}
