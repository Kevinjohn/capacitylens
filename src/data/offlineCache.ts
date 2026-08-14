import { SCOPED_KEYS, type AppData } from "@capacitylens/shared/types/entities";
import type { AuthMode, AuthUser } from "../auth/authContext";
import { validateAuthUser } from "../auth/validateAuthUser";
import { isRecord, validateAccountSlice } from "./validateAccountSlice";
import { isAccountRole, type Role } from "@capacitylens/shared/account/types";
import { API_BASE } from "./apiConfig";
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

const OFFLINE_PREF_KEY = `${STORAGE_KEY_PREFIX}offlineRead`;
const DB_NAME = "capacitylens-offline-v1";
const STORE_NAME = "records";
const KEY_STORE_NAME = "keys";
const DEVICE_KEY_ID = "device-aes-gcm-v1";
const WRITE_BOUNDARY_ID = "write-boundary-v1";
export const OFFLINE_WRITE_BOUNDARY_STORAGE_KEY = `${STORAGE_KEY_PREFIX}offlineWriteBoundary`;
const SHELL_CACHE_PREFIX = "capacitylens-shell-";
const SHELL_METADATA_CACHE = "capacitylens-offline-shell-metadata-v1";
const ACTIVE_SHELL_POINTER = "/__capacitylens-offline/active-shell";
const OFFLINE_WORKER_URL = "/offline-worker.js";
const SHELL_ACTIVATION_TIMEOUT_MS = 30_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedRecord<T> {
  key: string;
  savedAt: number;
  value: T;
}

interface EncryptedRecord {
  key: string;
  savedAt: number;
  version: 1;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

export interface OfflineAuthSnapshot {
  authMode: AuthMode;
  user: AuthUser;
  canCreateAccount: boolean;
  multiAccount: boolean;
}

interface OfflineAccountSummary {
  id: string;
  name: string;
  role: Role;
}

interface OfflineState {
  readOnly: boolean;
  lastUpdated: number | null;
  cacheWriteFailed: boolean;
}

type OfflineReadOwner = "identity" | "accounts" | "tenant" | "cleanup";

let scope: { origin: string; userId: string } | null = null;
let state: OfflineState = {
  readOnly: false,
  lastUpdated: null,
  cacheWriteFailed: false,
};
let offlineReadOwner: OfflineReadOwner | null = null;
// Monotonic in-memory tag for role/data projections resolved before an offline episode. It advances
// only when entering offline read mode; clearing the marker retains the new tag so pre-offline
// authority cannot become current again while live data and membership are being revalidated.
let offlineEpisode = 0;
// Cleanup advances this before touching IndexedDB. The durable companion token closes the same
// race across tabs, whose JavaScript modules necessarily have independent counters.
let cacheGeneration = 0;
const listeners = new Set<() => void>();
const preferenceListeners = new Set<() => void>();
const SLICE_REWRITE_INTERVAL_MS = 5 * 60 * 1000;
const recentSliceWrites = new WeakMap<IDBFactory, Map<string, { signature: string; writtenAt: number }>>();
const CACHED_SLICE_KEYS = ["accounts", ...SCOPED_KEYS] as const;

function sliceSignature(data: AppData): string {
  // Server revisions are the persistence change marker. This signature is much smaller to build
  // than serialising the whole tenant and is exact under the server-owned updatedAt contract.
  return CACHED_SLICE_KEYS.map(
    (table) => `${table}:${data[table].map((row) => `${row.id}@${row.updatedAt}`).join(",")}`,
  ).join("|");
}

function publishPreference(): void {
  for (const listener of preferenceListeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === OFFLINE_PREF_KEY) {
      if (event.newValue !== "on") resetOfflineState();
      publishPreference();
      return;
    }
    if (event.key === OFFLINE_WRITE_BOUNDARY_STORAGE_KEY) {
      // Sign-out/device cleanup in another tab owns the new boundary. Drop all page-local claims
      // immediately; the durable token independently rejects writes that began before the sweep.
      cacheGeneration += 1;
      lastSweptAt = 0;
      if (typeof indexedDB !== "undefined") recentSliceWrites.get(indexedDB)?.clear();
      resetOfflineState();
    }
  });
}

interface WriteBoundary {
  generation: number;
  token: string | null;
}

export function offlineShellAvailable(environment: { PROD: boolean; MODE: string }): boolean {
  return environment.PROD || environment.MODE === "test";
}

/** Does this registration belong to our app-shell worker? Any of its three lifecycle slots proves
 * ownership, so revalidation and teardown recognise the same registrations. */
function isOfflineWorkerRegistration(registration: ServiceWorkerRegistration): boolean {
  return [registration.active, registration.waiting, registration.installing].some((worker) =>
    worker?.scriptURL.endsWith(OFFLINE_WORKER_URL),
  );
}

/** Revalidate the durable shell promised by the device preference. A browser/site-data cleanup can
 * remove the worker or cache without removing localStorage, so the preference must fail closed. */
export async function revalidateOfflineShell(): Promise<boolean> {
  if (!offlineReadEnabled()) return false;
  try {
    if (!("serviceWorker" in navigator) || typeof caches === "undefined") throw new Error("unsupported");
    const registrations = await navigator.serviceWorker.getRegistrations();
    const workerPresent = registrations.some(isOfflineWorkerRegistration);
    const metadata = await caches.open(SHELL_METADATA_CACHE);
    const pointer = await metadata.match(ACTIVE_SHELL_POINTER);
    const cacheName = pointer ? await pointer.text() : "";
    const shellPresent =
      cacheName.startsWith(SHELL_CACHE_PREFIX) &&
      (await caches.has(cacheName)) &&
      Boolean(await (await caches.open(cacheName)).match("/"));
    if (workerPresent && shellPresent) return true;
  } catch (error) {
    console.warn("offlineCache: the promised offline shell could not be revalidated", error);
  }
  try {
    localStorage.removeItem(OFFLINE_PREF_KEY);
  } catch (error) {
    console.warn("offlineCache: the stale offline preference could not be removed", error);
  }
  publishPreference();
  return false;
}

function originKey(): string {
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
function awaitTx(tx: IDBTransaction, errorMessage: string, abortMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(errorMessage));
    tx.onabort = () => reject(tx.error ?? new Error(abortMessage));
  });
}

/** Settle on a single request. No abort handler: an aborted transaction fires the request's own
 * error event, so these read paths reject exactly as they did with a hand-written promise. */
function awaitRequest<T>(request: IDBRequest<T>, failureMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(failureMessage));
  });
}

function openOfflineDb(): Promise<IDBDatabase> {
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
      void maybeSweepExpiredRecords(db).then(
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

/** The sweep is retention HYGIENE, not the age gate: get() independently rejects and deletes any
 * record past MAX_AGE_MS, so nothing over-age is ever served between sweeps. Deserialising every
 * record on every connection is the expensive part, so once an hour per page is enough. A clock
 * that moved backwards (or a cleanup reset) always sweeps. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let lastSweptAt = 0;

function maybeSweepExpiredRecords(db: IDBDatabase): Promise<void> {
  const sweptAt = Date.now();
  const sinceLastSweep = sweptAt - lastSweptAt;
  if (sinceLastSweep >= 0 && sinceLastSweep < SWEEP_INTERVAL_MS) return Promise.resolve();
  // Only a completed sweep consumes the interval; a failed one still rejects this connection and
  // is re-attempted by the next open.
  return sweepExpiredRecords(db).then(() => {
    lastSweptAt = sweptAt;
  });
}

function webCrypto(): Crypto {
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

async function deviceKey(db: IDBDatabase): Promise<CryptoKey> {
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

function advanceWriteBoundary(): {
  token: string;
  storageError: unknown | null;
} {
  cacheGeneration += 1;
  // A cleanup rewrites the whole store; the next connection sweeps rather than trusting the
  // interval recorded before the wipe.
  lastSweptAt = 0;
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

async function initialiseWriteBoundary(db: IDBDatabase): Promise<void> {
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

function associatedData(key: string, savedAt: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${key}:${savedAt}:capacitylens-offline-v1`);
}

async function writeEncryptedRecord<T>(record: CachedRecord<T>): Promise<void> {
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

const pendingWrites = new Map<string, Promise<void>>();

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

function validateAuthSnapshot(value: unknown): OfflineAuthSnapshot | null {
  if (!isRecord(value) || !["off", "password", "sso"].includes(String(value.authMode))) return null;
  if (!validateAuthUser(value.user, value.authMode !== "off")) return null;
  if (typeof value.canCreateAccount !== "boolean" || typeof value.multiAccount !== "boolean") return null;
  return value as unknown as OfflineAuthSnapshot;
}

function validateAccountSummaries(value: unknown): OfflineAccountSummary[] | null {
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

function authKey(): string {
  return `auth:${originKey()}`;
}

/** Build a user-scoped cache key. Cleanup passes the scope it captured before the boundary advance
 * instead of rebuilding the same strings inline. */
function scopedKey(kind: "accounts" | "slice", suffix = "", forScope = scope): string {
  if (!forScope) throw new Error("Offline cache scope is unavailable until a user has been verified.");
  return `${kind}:${forScope.origin}:${forScope.userId}${suffix}`;
}

/** Is read-only offline access enabled on this device? Preference failures fail closed. */
export function offlineReadEnabled(): boolean {
  try {
    return localStorage.getItem(OFFLINE_PREF_KEY) === "on";
  } catch (error) {
    console.warn("offlineCache: the offline preference could not be read; disabling offline access", error);
    return false;
  }
}

export function subscribeOfflinePreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => preferenceListeners.delete(listener);
}

/** Registration creation precedes the worker's install/activate lifecycle. The worker publishes
 * its active-shell pointer inside activate.waitUntil(), so `activated` is the first state that
 * proves every shell asset was staged and the neutral index entry was promoted successfully. */
async function waitForOfflineShellActivation(registration: ServiceWorkerRegistration): Promise<void> {
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) throw new Error("Offline shell registration did not provide a service worker.");
  if (worker.state === "activated") return;
  if (worker.state === "redundant") {
    throw new Error("Offline shell installation failed before activation.");
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener("statechange", onStateChange);
      if (error) reject(error);
      else resolve();
    };
    const onStateChange = () => {
      if (worker.state === "activated") finish();
      else if (worker.state === "redundant") {
        finish(new Error("Offline shell installation failed before activation."));
      }
    };
    const timer = setTimeout(
      () => finish(new Error("Offline shell installation did not finish in time.")),
      SHELL_ACTIVATION_TIMEOUT_MS,
    );
    worker.addEventListener("statechange", onStateChange);
    onStateChange();
  });
}

/** Enable or disable offline access on this device. Disabling also removes the app-shell worker. */
export async function setOfflineReadEnabled(enabled: boolean): Promise<void> {
  if (enabled && !offlineShellAvailable(import.meta.env)) {
    throw new Error("Offline access can only be enabled from a production build.");
  }
  if (enabled && !("serviceWorker" in navigator)) {
    throw new Error("Offline access is not supported by this browser.");
  }

  try {
    if (enabled) {
      webCrypto();
      const db = await openOfflineDb();
      try {
        await deviceKey(db);
        await initialiseWriteBoundary(db);
      } finally {
        db.close();
      }
      const registration = await navigator.serviceWorker.register(OFFLINE_WORKER_URL, { scope: "/" });
      await waitForOfflineShellActivation(registration);
      localStorage.setItem(OFFLINE_PREF_KEY, "on");
      publishPreference();
      return;
    }

    localStorage.removeItem(OFFLINE_PREF_KEY);
    publishPreference();
    setOfflineCacheWriteFailed(false);
    await clearAllOfflineData();
    if (!("serviceWorker" in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.filter(isOfflineWorkerRegistration).map((registration) => registration.unregister()),
    );
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) || name === SHELL_METADATA_CACHE)
          .map((name) => caches.delete(name)),
      );
    }
  } catch (error) {
    // A failed enable must fail closed: without a working shell cache the preference would promise
    // offline access that cannot actually boot. A failed disable remains disabled even if browser
    // cleanup itself was blocked; the stale worker contains no tenant data and is never consulted.
    if (enabled) {
      try {
        localStorage.removeItem(OFFLINE_PREF_KEY);
      } catch (cleanupError) {
        console.warn("offlineCache: failed to clean up after offline enablement failed", cleanupError);
      }
    }
    throw error;
  }
}

type OfflineCacheWriteResult =
  { status: "written" } | { status: "skipped"; reason: "disabled" | "unscoped" | "unchanged" };

/** One cached record kind: the shared enable/scope guards and write envelope, plus the validated
 * read. `keyFor` and `validate` receive the public wrapper's own arguments, so a scoped key and a
 * per-account validation stay with the caller and every exported signature is unchanged. */
function cachedRecord<T, A extends unknown[] = []>(
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

/** Decline an unchanged tenant-slice rewrite. Encryption dominates the cost of a cache write and
 * live refreshes re-deliver identical data, so a signature match inside the interval skips. */
function sliceRewriteGate(key: string, data: AppData, now: number): OfflineCacheWriteResult | (() => void) {
  const signature = sliceSignature(data);
  const factory = typeof indexedDB === "undefined" ? null : indexedDB;
  let recent = factory ? recentSliceWrites.get(factory) : undefined;
  if (factory && !recent) {
    recent = new Map();
    recentSliceWrites.set(factory, recent);
  }
  const prior = recent?.get(key);
  if (prior?.signature === signature && now - prior.writtenAt < SLICE_REWRITE_INTERVAL_MS) {
    return { status: "skipped", reason: "unchanged" };
  }
  return () => recent?.set(key, { signature, writtenAt: now });
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
  scope = { origin: originKey(), userId: snapshot.user.id };
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
    scope = { origin: originKey(), userId: record.value.user.id };
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

/**
 * Publish which boundary established the current offline claim. Identity/account-list refreshes
 * cannot clear a tenant-slice claim; only a successful tenant reload or cleanup has that authority.
 */
export function setOfflineReadState(
  owner: OfflineReadOwner,
  readOnly: boolean,
  lastUpdated: number | null = null,
): void {
  if (readOnly && offlineReadOwner === "tenant" && owner !== "tenant") return;
  if (!readOnly && offlineReadOwner === "tenant" && owner !== "tenant" && owner !== "cleanup") return;
  if (state.readOnly === readOnly && state.lastUpdated === lastUpdated && (!readOnly || offlineReadOwner === owner)) {
    return;
  }
  if (readOnly && !state.readOnly) offlineEpisode += 1;
  offlineReadOwner = readOnly ? owner : null;
  state = { ...state, readOnly, lastUpdated };
  for (const listener of listeners) listener();
}

function setOfflineCacheWriteFailed(cacheWriteFailed: boolean): void {
  if (state.cacheWriteFailed === cacheWriteFailed) return;
  state = { ...state, cacheWriteFailed };
  for (const listener of listeners) listener();
}

/** Drop every page-local claim on the cache: the verified-user scope, the write-failure flag and
 * any offline read state. Cleanup and cross-tab boundary changes all end here. */
function resetOfflineState(): void {
  scope = null;
  setOfflineCacheWriteFailed(false);
  setOfflineReadState("cleanup", false);
}

/** Current offline episode tag; reactive consumers read it after their offline-state subscription. */
export function offlineStateEpisode(): number {
  return offlineEpisode;
}

export function offlineStateSnapshot(): OfflineState {
  return state;
}

export function subscribeOfflineState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
