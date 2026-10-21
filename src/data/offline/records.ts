import type { SliceRewriteResult } from "./state";
import { isAccountRole } from "@capacitylens/shared/account/types";
import { parseAuthUser } from "@/auth/validateAuthUser";
import { isAuthMode } from "@/auth/authStatus";
import { STORE_NAME, MAX_AGE_MS } from "./constants";
import { awaitRequest, awaitTx, openOfflineDb } from "./idb";
import {
  readOrCreateDeviceKey,
  assertWebCrypto,
  buildAssociatedData,
  readWriteBoundary,
  writeEncryptedRecord,
} from "./crypto";
import {
  pendingWrites,
  readCacheWriteFailureGeneration,
  recordOfflineCacheWriteFailure,
  recordOfflineCacheWriteSuccess,
  scope,
  isOfflineReadEnabled,
} from "./state";
import type { CachedRecord, OfflineAuthSnapshot, OfflineAccountSummary, OfflineCacheWriteResult } from "./types";
import { isRecord } from "@capacitylens/shared/lib/isRecord";
// Preserve same-key acceptance order even when encryption finishes out of order;
// a rejected write must not block a later live value.
async function put<T>(record: CachedRecord<T>): Promise<"stored" | "discarded"> {
  const generation = readCacheWriteFailureGeneration();
  const writeBoundary = readWriteBoundary();
  const previous = pendingWrites.get(record.key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => writeEncryptedRecord(record, writeBoundary));
  pendingWrites.set(record.key, current);
  try {
    const outcome = await current;
    if (outcome === "stored") recordOfflineCacheWriteSuccess(record.key, generation);
    return outcome;
  } catch (error) {
    // Record the failed cache write before propagating it so the cache promise cannot remain falsely healthy.
    recordOfflineCacheWriteFailure(record.key, generation);
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
    if (isValidEncryptedRecord(record, key)) {
      try {
        const plaintext = await decryptRecord(db, record);
        return {
          key,
          savedAt: record.savedAt,
          value: JSON.parse(new TextDecoder().decode(plaintext)) as T,
        };
      } catch (error) {
        // An encrypted record that cannot authenticate must be discarded; warn rather than trust or silently reuse it.
        console.warn("offlineCache: encrypted cache authentication failed; deleting the entry", error);
      }
    }
    await deleteKey(key);
    return null;
  } finally {
    db.close();
  }
}

type ValidEncryptedRecord = Record<string, unknown> & {
  key: string;
  savedAt: number;
  version: 1;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

function isValidEncryptedRecord(record: Record<string, unknown>, key: string): record is ValidEncryptedRecord {
  const age = typeof record.savedAt === "number" ? Date.now() - record.savedAt : Number.NaN;
  return (
    record.key === key &&
    typeof record.savedAt === "number" &&
    Number.isFinite(record.savedAt) &&
    age >= 0 &&
    age <= MAX_AGE_MS &&
    record.version === 1 &&
    isArrayBuffer(record.iv) &&
    isArrayBuffer(record.ciphertext)
  );
}

async function decryptRecord(db: IDBDatabase, record: ValidEncryptedRecord): Promise<ArrayBuffer> {
  const encryptionKey = await readOrCreateDeviceKey(db);
  return assertWebCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: record.iv,
      additionalData: buildAssociatedData(record.key, record.savedAt),
      tagLength: 128,
    },
    encryptionKey,
    record.ciphertext,
  );
}

// Cross-realm ArrayBuffers can fail instanceof. Check their internal brand while
// leaving Web Crypto to enforce the final BufferSource contract.
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

/** Validates the cached auth snapshot before it is used offline. */
export function parseAuthSnapshot(value: unknown): OfflineAuthSnapshot | null {
  if (!isRecord(value) || !isAuthMode(value.authMode)) return null;
  if (!parseAuthUser({ value: value.user, requireEmail: value.authMode !== "off" })) return null;
  if (typeof value.canCreateAccount !== "boolean" || typeof value.multiAccount !== "boolean") return null;
  return value as unknown as OfflineAuthSnapshot;
}

/** Validates the cached account summaries while preserving malformed-data distinction. */
export function parseAccountSummaries(value: unknown): OfflineAccountSummary[] | null {
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

// Share cache guards and write envelopes while keeping per-account key and validation
// rules with each caller.
export function createCachedRecord<T, A extends unknown[] = []>(
  keyFor: (...parameters: A) => string,
  validate: (value: unknown, ...parameters: A) => T | null,
  options: {
    /** Reads that require a verified scope. The identity snapshot deliberately does not: a cold
     * offline boot reads it before any scope exists. */
    readNeedsScope?: boolean;
    /** Runs after the guards with the key and envelope timestamp. Returns a skipped result or a
     * write-required result carrying complete, called only once the write has landed. */
    gate?: (key: string, value: T, savedAt: number) => SliceRewriteResult;
  } = {},
) {
  const { readNeedsScope = true, gate } = options;
  return {
    async write(value: T, ...parameters: A): Promise<OfflineCacheWriteResult> {
      if (!isOfflineReadEnabled()) return { kind: "skipped", reason: "disabled" };
      if (!scope) return { kind: "skipped", reason: "unscoped" };
      const key = keyFor(...parameters);
      const savedAt = Date.now();
      const written = gate?.(key, value, savedAt);
      if (written?.kind === "skipped") return written;
      const outcome = await put({ key, savedAt, value });
      if (outcome === "discarded") return { kind: "skipped", reason: "discarded" };
      written?.complete();
      return { kind: "written" };
    },
    async read(...parameters: A): Promise<CachedRecord<T> | null> {
      if (!isOfflineReadEnabled() || (readNeedsScope && !scope)) return null;
      return getValidated(keyFor(...parameters), (value) => validate(value, ...parameters));
    },
  };
}
