import { SCOPED_KEYS, type AppData } from "@capacitylens/shared/types/entities";
import type { AuthMode, AuthUser } from "../auth/authContext";
import { validateAuthUser } from "../auth/validateAuthUser";
import { validateAccountSlice } from "./validateAccountSlice";
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

export interface OfflineAccountSummary {
  id: string;
  name: string;
  role: Role;
}

interface OfflineState {
  readOnly: boolean;
  lastUpdated: number | null;
  cacheWriteFailed: boolean;
}

export type OfflineReadOwner = "identity" | "accounts" | "tenant" | "cleanup";

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
      if (event.newValue !== "on") {
        scope = null;
        setOfflineCacheWriteFailed(false);
        setOfflineReadState("cleanup", false);
      }
      publishPreference();
      return;
    }
    if (event.key === OFFLINE_WRITE_BOUNDARY_STORAGE_KEY) {
      // Sign-out/device cleanup in another tab owns the new boundary. Drop all page-local claims
      // immediately; the durable token independently rejects writes that began before the sweep.
      cacheGeneration += 1;
      if (typeof indexedDB !== "undefined") recentSliceWrites.get(indexedDB)?.clear();
      scope = null;
      setOfflineCacheWriteFailed(false);
      setOfflineReadState("cleanup", false);
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

/** Revalidate the durable shell promised by the device preference. A browser/site-data cleanup can
 * remove the worker or cache without removing localStorage, so the preference must fail closed. */
export async function revalidateOfflineShell(): Promise<boolean> {
  if (!offlineReadEnabled()) return false;
  try {
    if (!("serviceWorker" in navigator) || typeof caches === "undefined") throw new Error("unsupported");
    const registrations = await navigator.serviceWorker.getRegistrations();
    const workerPresent = registrations.some((registration) =>
      [registration.active, registration.waiting, registration.installing].some((worker) =>
        worker?.scriptURL.endsWith("/offline-worker.js"),
      ),
    );
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
  return new Promise((resolve, reject) => {
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
    request.onerror = () => reject(request.error ?? new Error("Expired offline data could not be inspected."));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Expired offline data could not be removed."));
    tx.onabort = () => reject(tx.error ?? new Error("Offline retention cleanup was aborted."));
  });
}

function webCrypto(): Crypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto is unavailable; encrypted offline access cannot be enabled.");
  }
  return crypto;
}

async function readDeviceKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(KEY_STORE_NAME, "readonly").objectStore(KEY_STORE_NAME).get(DEVICE_KEY_ID);
    request.onsuccess = () => {
      const value = request.result as { id?: unknown; value?: unknown } | undefined;
      const candidate = value?.value as Partial<CryptoKey> | undefined;
      resolve(
        value?.id === DEVICE_KEY_ID && candidate?.type === "secret" && candidate.algorithm?.name === "AES-GCM"
          ? (candidate as CryptoKey)
          : null,
      );
    };
    request.onerror = () => reject(request.error ?? new Error("The offline encryption key could not be read."));
  });
}

async function deviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await readDeviceKey(db);
  if (existing) return existing;
  const generated = await webCrypto().subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE_NAME, "readwrite");
      tx.objectStore(KEY_STORE_NAME).add({
        id: DEVICE_KEY_ID,
        value: generated,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("The offline encryption key could not be stored."));
      tx.onabort = () => reject(tx.error ?? new Error("The offline encryption key write was aborted."));
    });
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

function readDurableWriteBoundary(store: IDBObjectStore): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = store.get(WRITE_BOUNDARY_ID);
    request.onsuccess = () => {
      const value = request.result as { id?: unknown; token?: unknown } | undefined;
      resolve(value?.id === WRITE_BOUNDARY_ID && typeof value.token === "string" ? value.token : null);
    };
    request.onerror = () => reject(request.error ?? new Error("The offline write boundary could not be read."));
  });
}

async function initialiseWriteBoundary(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(KEY_STORE_NAME, "readwrite");
  const store = tx.objectStore(KEY_STORE_NAME);
  const durableToken = await readDurableWriteBoundary(store);
  const token = durableToken ?? storedWriteBoundaryToken() ?? newWriteBoundaryToken();
  if (durableToken === null) store.put({ id: WRITE_BOUNDARY_ID, token });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("The offline write boundary could not be established."));
    tx.onabort = () => reject(tx.error ?? new Error("The offline write boundary update was aborted."));
  });
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
    await new Promise<void>((resolve, reject) => {
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
      boundaryRequest.onerror = () =>
        reject(boundaryRequest.error ?? new Error("The offline write boundary could not be read."));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("The offline cache could not be updated."));
      tx.onabort = () => reject(tx.error ?? new Error("The offline cache update was aborted."));
    });
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
    const record = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("The offline cache could not be read."));
    });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("The offline cache entry could not be removed."));
      tx.onabort = () => reject(tx.error ?? new Error("Offline cache entry deletion was aborted."));
    });
  } finally {
    db.close();
  }
}

function authKey(): string {
  return `auth:${originKey()}`;
}

function scopedKey(kind: "accounts" | "slice", suffix = ""): string {
  if (!scope) throw new Error("Offline cache scope is unavailable until a user has been verified.");
  return `${kind}:${scope.origin}:${scope.userId}${suffix}`;
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
      const registration = await navigator.serviceWorker.register("/offline-worker.js", { scope: "/" });
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
      registrations
        .filter((registration) =>
          [registration.active, registration.waiting, registration.installing].some((worker) =>
            worker?.scriptURL.endsWith("/offline-worker.js"),
          ),
        )
        .map((registration) => registration.unregister()),
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

export type OfflineCacheWriteResult =
  { status: "written" } | { status: "skipped"; reason: "disabled" | "unscoped" | "unchanged" };

/** Persist the last verified identity and make it the cache scope for this page. */
export async function cacheAuthSnapshot(snapshot: OfflineAuthSnapshot): Promise<OfflineCacheWriteResult> {
  scope = { origin: originKey(), userId: snapshot.user.id };
  if (!offlineReadEnabled()) return { status: "skipped", reason: "disabled" };
  await put({ key: authKey(), savedAt: Date.now(), value: snapshot });
  return { status: "written" };
}

/** Restore the last verified identity for an offline boot. Never fabricates a session. */
export async function readCachedAuthSnapshot(
  opts: { acceptEffects?: () => boolean } = {},
): Promise<CachedRecord<OfflineAuthSnapshot> | null> {
  if (!offlineReadEnabled()) return null;
  const record = await getValidated(authKey(), validateAuthSnapshot);
  if (record && (opts.acceptEffects?.() ?? true)) {
    // A cache miss is evidence only about durable cache state. It must not revoke a scope that a
    // concurrent successful live /me already established through cacheAuthSnapshot; explicit
    // sign-out/device cleanup owns scope removal. A cached hit may still establish cold-boot scope.
    scope = { origin: originKey(), userId: record.value.user.id };
  }
  return record;
}

export async function cacheAccountSummaries(summaries: OfflineAccountSummary[]): Promise<OfflineCacheWriteResult> {
  if (!offlineReadEnabled()) return { status: "skipped", reason: "disabled" };
  if (!scope) return { status: "skipped", reason: "unscoped" };
  await put({
    key: scopedKey("accounts"),
    savedAt: Date.now(),
    value: summaries,
  });
  return { status: "written" };
}

export async function readCachedAccountSummaries(): Promise<CachedRecord<OfflineAccountSummary[]> | null> {
  if (!offlineReadEnabled() || !scope) return null;
  return getValidated(scopedKey("accounts"), validateAccountSummaries);
}

export async function cacheAccountSlice(accountId: string, data: AppData): Promise<OfflineCacheWriteResult> {
  if (!offlineReadEnabled()) return { status: "skipped", reason: "disabled" };
  if (!scope) return { status: "skipped", reason: "unscoped" };
  const key = scopedKey("slice", `:${accountId}`);
  const now = Date.now();
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
  await put({
    key,
    savedAt: now,
    value: data,
  });
  recent?.set(key, { signature, writtenAt: now });
  return { status: "written" };
}

export async function readCachedAccountSlice(accountId: string): Promise<CachedRecord<AppData> | null> {
  if (!offlineReadEnabled() || !scope) return null;
  return getValidated(scopedKey("slice", `:${accountId}`), (value) => validateAccountSlice(value, accountId));
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

/** Remove this user's cached identity, account list and slices. Called before every sign-out. */
export async function clearOfflineDataForCurrentUser(): Promise<void> {
  const boundary = advanceWriteBoundary();
  if (typeof indexedDB === "undefined") {
    scope = null;
    setOfflineCacheWriteFailed(false);
    setOfflineReadState("cleanup", false);
    if (boundary.storageError) throw boundary.storageError;
    // The caller must know that no durable records were removed. Sign-out uses this rejection to
    // remove the offline opt-in, so records left behind while browser storage is unavailable can
    // never be accepted on a later networkless boot.
    throw new Error("IndexedDB is unavailable on this device.");
  }
  const currentScope = scope;
  const db = await openOfflineDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME, STORE_NAME], "readwrite");
      tx.objectStore(KEY_STORE_NAME).put({
        id: WRITE_BOUNDARY_ID,
        token: boundary.token,
      });
      const store = tx.objectStore(STORE_NAME);
      // Sign-out only inspects and deletes keys. A key cursor avoids deserialising every other
      // user's encrypted payload while the session-ending path walks this shared object store.
      const request = store.openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const key = String(cursor.key);
        const accountsKey = currentScope ? `accounts:${currentScope.origin}:${currentScope.userId}` : null;
        const slicePrefix = currentScope ? `slice:${currentScope.origin}:${currentScope.userId}:` : null;
        if (key === authKey() || key === accountsKey || (slicePrefix && key.startsWith(slicePrefix)))
          store.delete(cursor.key);
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("The offline cache could not be cleared."));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("The offline cache could not be cleared."));
      tx.onabort = () => reject(tx.error ?? new Error("The offline cache clear was aborted."));
    });
  } finally {
    db.close();
    scope = null;
    setOfflineCacheWriteFailed(false);
    setOfflineReadState("cleanup", false);
  }
  const recent = recentSliceWrites.get(indexedDB);
  if (currentScope && recent) {
    const accountsKey = `accounts:${currentScope.origin}:${currentScope.userId}`;
    const slicePrefix = `slice:${currentScope.origin}:${currentScope.userId}:`;
    for (const key of recent.keys()) if (key === accountsKey || key.startsWith(slicePrefix)) recent.delete(key);
  }
  if (boundary.storageError) throw boundary.storageError;
}

/** Remove every CapacityLens offline identity and account snapshot from this browser profile.
 * Used only by the explicit “Clear device data” action; normal sign-out remains user-scoped. */
export async function clearAllOfflineData(): Promise<void> {
  const boundary = advanceWriteBoundary();
  if (typeof indexedDB === "undefined") {
    scope = null;
    setOfflineCacheWriteFailed(false);
    setOfflineReadState("cleanup", false);
    if (boundary.storageError) throw boundary.storageError;
    return;
  }
  const db = await openOfflineDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME, STORE_NAME], "readwrite");
      // “Clear device data” is the recovery boundary for corrupt or incompatible CryptoKey
      // structured clones too. Remove every key-store entry, then restore only the generation
      // token that prevents writes started before this wipe from repopulating the records store.
      const keyStore = tx.objectStore(KEY_STORE_NAME);
      keyStore.clear();
      keyStore.put({ id: WRITE_BOUNDARY_ID, token: boundary.token });
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("The offline cache could not be cleared."));
      tx.onabort = () => reject(tx.error ?? new Error("The offline cache clear was aborted."));
    });
  } finally {
    db.close();
    scope = null;
    setOfflineCacheWriteFailed(false);
    setOfflineReadState("cleanup", false);
  }
  recentSliceWrites.get(indexedDB)?.clear();
  if (boundary.storageError) throw boundary.storageError;
}
