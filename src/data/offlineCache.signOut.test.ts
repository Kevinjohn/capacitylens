import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDBFactory, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";

import { seed } from "@capacitylens/shared/data/seed";
import { SCOPED_KEYS, emptyAppData, scopedTables, type AppData } from "@capacitylens/shared/types/entities";

import {
  cacheAccountSlice,
  cacheAccountSummaries,
  cacheAuthSnapshot,
  clearAllOfflineData,
  clearOfflineDataForCurrentUser,
  isOfflineReadEnabled,
  readOfflineStateSnapshot,
  readCachedAuthSnapshot,
  readCachedAccountSlice,
  setOfflineReadEnabled,
} from "./offlineCache";

const DB_NAME = "capacitylens-offline-v1";
const STORE_NAME = "records";
const KEY_STORE_NAME = "keys";

function currentCacheNamespace(): string {
  return `${window.location.origin}|api:${window.location.origin}`;
}

/** Open the offline database the way the module under test does, creating both stores when the
 * scenario writes before any production code has. Every raw helper below shares it. */
function openTestDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(KEY_STORE_NAME)) {
        request.result.createObjectStore(KEY_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRawInto(storeName: string, record: unknown): Promise<void> {
  const db = await openTestDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function putRawKey(record: unknown): Promise<void> {
  return putRawInto(KEY_STORE_NAME, record);
}

async function getRaw(key: string): Promise<unknown> {
  const db = await openTestDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

function authSnapshot(userId: string) {
  return {
    authMode: "password" as const,
    user: { id: userId, email: `${userId}@example.test`, name: userId },
    canCreateAccount: false,
    multiAccount: false,
  };
}

function accountSlice(accountId: string): AppData {
  const source = seed();
  const slice = emptyAppData();
  slice.accounts = source.accounts.filter((account) => account.id === accountId);
  const sourceTables = scopedTables(source);
  const sliceTables = scopedTables(slice);
  for (const key of SCOPED_KEYS) {
    sliceTables[key] = sourceTables[key].filter((row) => row.accountId === accountId);
  }
  return slice;
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function registerTenantCacheHooks() {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.setItem("capacitylens/offlineRead", "on");
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
}

describe("offline tenant cache sign-out failures", () => {
  registerTenantCacheHooks();
  it("uses the fallback message when the sign-out key cursor errors without an error object", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const originalOpenKeyCursor = FakeIDBObjectStore.prototype.openKeyCursor;
    vi.spyOn(FakeIDBObjectStore.prototype, "openKeyCursor").mockImplementation(function (
      this: IDBObjectStore,
      query,
      direction,
    ) {
      if (this.name !== STORE_NAME) return originalOpenKeyCursor.call(this, query, direction);
      const request = { error: null } as IDBRequest<IDBCursor | null>;
      Object.defineProperty(request, "onerror", {
        set(callback: ((event: Event) => void) | null) {
          if (callback) queueMicrotask(() => callback(new Event("error")));
        },
      });
      return request;
    });

    await expect(clearOfflineDataForCurrentUser()).rejects.toThrow("The offline cache could not be cleared");
  });

  it("reports unavailable browser storage so sign-out can disable stale offline data", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const availableIndexedDb = indexedDB;
    vi.stubGlobal("indexedDB", undefined);

    await expect(clearOfflineDataForCurrentUser()).rejects.toThrow("IndexedDB is unavailable");

    // Mirrors AuthProvider's fail-closed fallback. Disabling must remove the preference even when
    // the records cannot currently be reached, and restoring IndexedDB must not make them eligible.
    await setOfflineReadEnabled(false);
    expect(isOfflineReadEnabled()).toBe(false);
    vi.stubGlobal("indexedDB", availableIndexedDb);
    await expect(readCachedAuthSnapshot()).resolves.toBeNull();
  });
});

describe("offline tenant cache sign-out concurrency", () => {
  registerTenantCacheHooks();
  it("sign-out cleanup in another page rejects identity, directory and slice writes already encrypting", async () => {
    // Establish the same verified-user scope in two independent module instances, mirroring tabs.
    await cacheAuthSnapshot(authSnapshot("user-a"));
    vi.resetModules();
    const otherPage = await import("./offlineCache");
    await expect(otherPage.readCachedAuthSnapshot()).resolves.toMatchObject({
      value: { user: { id: "user-a" } },
    });

    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let releaseEncryption!: () => void;
    const encryptionGate = new Promise<void>((resolve) => {
      releaseEncryption = resolve;
    });
    let reportAllStarted!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      reportAllStarted = resolve;
    });
    let started = 0;
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (algorithm, key, data) => {
      started += 1;
      if (started === 3) reportAllStarted();
      await encryptionGate;
      return originalEncrypt(algorithm, key, data);
    });

    const writes = [
      cacheAuthSnapshot(authSnapshot("user-a")),
      cacheAccountSummaries([{ id: "a-studio", name: "Studio", role: "owner" }]),
      cacheAccountSlice("a-studio", accountSlice("a-studio")),
    ];
    await allStarted;

    await otherPage.clearOfflineDataForCurrentUser();
    releaseEncryption();
    await Promise.all(writes);

    const origin = currentCacheNamespace();
    await expect(getRaw(`auth:${origin}`)).resolves.toBeUndefined();
    await expect(getRaw(`accounts:${origin}:user-a`)).resolves.toBeUndefined();
    await expect(getRaw(`slice:${origin}:user-a:a-studio`)).resolves.toBeUndefined();
  });
});

describe("offline tenant cache explicit wipe", () => {
  registerTenantCacheHooks();
  it("the explicit device-data wipe clears every user's cached slice", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSlice("a-studio", accountSlice("a-studio"));
    await cacheAuthSnapshot(authSnapshot("user-b"));
    await cacheAccountSlice("a-studio", emptyAppData());

    await clearAllOfflineData();
    await cacheAuthSnapshot(authSnapshot("user-a"));

    await expect(readCachedAccountSlice("a-studio")).resolves.toBeNull();
  });

  it("the explicit device-data wipe recovers from malformed persisted encryption key material", async () => {
    await putRawKey({
      id: "device-aes-gcm-v1",
      value: { type: "secret", algorithm: { name: "AES-GCM" } },
    });

    await expect(cacheAuthSnapshot(authSnapshot("user-a"))).rejects.toThrow();
    expect(readOfflineStateSnapshot().cacheWriteFailed).toBe(true);
    await clearAllOfflineData();

    await expect(cacheAuthSnapshot(authSnapshot("user-a"))).resolves.toEqual({ kind: "written" });
    expect(readOfflineStateSnapshot().cacheWriteFailed).toBe(false);
    await expect(readCachedAuthSnapshot()).resolves.toMatchObject({
      value: { user: { id: "user-a" } },
    });
  });
});
