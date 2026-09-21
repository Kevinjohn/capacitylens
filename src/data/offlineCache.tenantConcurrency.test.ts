import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDBFactory, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";

import { seed } from "@capacitylens/shared/data/seed";
import { SCOPED_KEYS, emptyAppData, scopedTables, type AppData } from "@capacitylens/shared/types/entities";

import {
  cacheAccountSlice,
  cacheAccountSummaries,
  cacheAuthSnapshot,
  clearAllOfflineData,
  readOfflineStateSnapshot,
  readCachedAccountSummaries,
  readCachedAuthSnapshot,
  readCachedAccountSlice,
  setOfflineReadState,
  subscribeOfflinePreference,
} from "./offlineCache";

const DAY_MS = 24 * 60 * 60 * 1000;
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

async function putRaw(record: unknown): Promise<void> {
  return putRawInto(STORE_NAME, record);
}

async function putEncryptedValue(key: string, value: unknown, savedAt = Date.now()): Promise<void> {
  const db = await openTestDb();
  try {
    const deviceKey = await new Promise<CryptoKey>((resolve, reject) => {
      const request = db.transaction(KEY_STORE_NAME, "readonly").objectStore(KEY_STORE_NAME).get("device-aes-gcm-v1");
      request.onsuccess = () => resolve((request.result as { value: CryptoKey }).value);
      request.onerror = () => reject(request.error);
    });
    const iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(`${key}:${savedAt}:capacitylens-offline-v1`),
        tagLength: 128,
      },
      deviceKey,
      new TextEncoder().encode(JSON.stringify(value)),
    );
    await putRaw({ key, savedAt, version: 1, iv: iv.buffer, ciphertext });
  } finally {
    db.close();
  }
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

describe("offline tenant cache concurrent writes", () => {
  registerTenantCacheHooks();
  it("drops writes whose generation changes during encryption", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(async (algorithm, key, data) => {
      await clearAllOfflineData();
      return originalEncrypt(algorithm, key, data);
    });

    await expect(cacheAccountSummaries([{ id: "a-studio", name: "Studio", role: "owner" }])).resolves.toEqual({
      kind: "written",
    });
    await expect(getRaw(`accounts:${currentCacheNamespace()}:user-a`)).resolves.toBeUndefined();
  });

  it("drops an envelope that ages out while encryption is pending", async () => {
    const savedAt = new Date("2026-01-01T00:00:00.000Z").getTime();
    const clock = vi.spyOn(Date, "now").mockReturnValue(savedAt);
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(async (algorithm, key, data) => {
      clock.mockReturnValue(savedAt + 7 * DAY_MS + 1);
      return originalEncrypt(algorithm, key, data);
    });
    await cacheAccountSummaries([{ id: "a-studio", name: "Studio", role: "owner" }]);
    await expect(getRaw(`accounts:${currentCacheNamespace()}:user-a`)).resolves.toBeUndefined();
  });

  it("deletes primitive and non-numeric-timestamp cache entries", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const key = `accounts:${currentCacheNamespace()}:user-a`;
    const originalGet = FakeIDBObjectStore.prototype.get;
    let returnedPrimitive = false;
    vi.spyOn(FakeIDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, query) {
      if (query === key && !returnedPrimitive) {
        returnedPrimitive = true;
        const request = { result: "poison", error: null } as IDBRequest;
        Object.defineProperty(request, "onsuccess", {
          set(callback: ((event: Event) => void) | null) {
            if (callback) queueMicrotask(() => callback(new Event("success")));
          },
        });
        return request;
      }
      return originalGet.call(this, query);
    });
    await expect(readCachedAccountSummaries()).resolves.toBeNull();
    await putRaw({ key, savedAt: "yesterday", version: 1, iv: new ArrayBuffer(1), ciphertext: new ArrayBuffer(1) });
    await expect(readCachedAccountSummaries()).resolves.toBeNull();
    await expect(getRaw(key)).resolves.toBeUndefined();
  });
});

describe("offline tenant cache malformed records", () => {
  registerTenantCacheHooks();
  it("sweeps a seeded envelope whose savedAt is not numeric", async () => {
    const key = "malformed-saved-at";
    await putRaw({ key, savedAt: "yesterday", version: 1, iv: new ArrayBuffer(1), ciphertext: new ArrayBuffer(1) });
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await expect(getRaw(key)).resolves.toBeUndefined();
  });

  it.each([
    ["auth user", { ...authSnapshot("user-a"), user: null }],
    ["boolean flags", { ...authSnapshot("user-a"), canCreateAccount: "no" }],
  ])("rejects poisoned authentication snapshots with invalid %s", async (_label, value) => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await putEncryptedValue(`auth:${currentCacheNamespace()}`, value);
    await expect(readCachedAuthSnapshot()).resolves.toBeNull();
  });

  it("rejects a non-array account-summary payload", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await putEncryptedValue(`accounts:${currentCacheNamespace()}:user-a`, { id: "a-studio" });
    await expect(readCachedAccountSummaries()).resolves.toBeNull();
  });
});

describe("offline tenant cache cross-tab boundaries", () => {
  registerTenantCacheHooks();
  it("observes offline preference and cleanup boundaries from another tab", async () => {
    localStorage.removeItem("capacitylens/offlineRead");
    await cacheAuthSnapshot(authSnapshot("user-a")); // establishes the live page's identity scope
    const preferenceChanged = vi.fn();
    const unsubscribe = subscribeOfflinePreference(preferenceChanged);

    localStorage.setItem("capacitylens/offlineRead", "on");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "capacitylens/offlineRead",
        newValue: "on",
      }),
    );
    await cacheAccountSlice("a-studio", accountSlice("a-studio"));
    expect(preferenceChanged).toHaveBeenCalledOnce();
    await expect(getRaw(`slice:${currentCacheNamespace()}:user-a:a-studio`)).resolves.toBeDefined();

    setOfflineReadState("tenant", true, 123);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "capacitylens/offlineWriteBoundary",
        newValue: "other-tab-sign-out",
      }),
    );
    expect(readOfflineStateSnapshot().readOnly).toBe(false);
    await cacheAccountSummaries([{ id: "a-studio", name: "Should not write", role: "owner" }]);
    await expect(getRaw(`accounts:${currentCacheNamespace()}:user-a`)).resolves.toBeUndefined();

    localStorage.removeItem("capacitylens/offlineRead");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "capacitylens/offlineRead",
        newValue: null,
      }),
    );
    expect(preferenceChanged).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("does not restore an identity cached for another configured backend origin", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "https://old-api.example.test");
    vi.resetModules();
    const oldBackend = await import("./offlineCache");
    await oldBackend.cacheAuthSnapshot(authSnapshot("user-a"));
    await expect(oldBackend.readCachedAuthSnapshot()).resolves.toMatchObject({
      value: { user: { id: "user-a" } },
    });

    vi.stubEnv("VITE_CAPACITYLENS_API", "https://new-api.example.test");
    vi.resetModules();
    const newBackend = await import("./offlineCache");

    await expect(newBackend.readCachedAuthSnapshot()).resolves.toBeNull();
  });
});

describe("offline tenant cache expiry", () => {
  registerTenantCacheHooks();
  it("expires account data after seven days", async () => {
    const savedAt = new Date("2026-07-01T00:00:00.000Z").getTime();
    const clock = vi.spyOn(Date, "now").mockReturnValue(savedAt);
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSlice("a-studio", accountSlice("a-studio"));

    const restored = await readCachedAccountSlice("a-studio");
    expect(restored?.value.accounts[0]?.name).toBe("Wayne Enterprises");

    clock.mockReturnValue(savedAt + 7 * DAY_MS + 1);
    await expect(readCachedAccountSlice("a-studio")).resolves.toBeNull();
  });
});

describe("offline tenant cache account slices", () => {
  registerTenantCacheHooks();
  it("round-trips attributed and unattributed allocation rows", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const slice = accountSlice("a-studio");
    const original = slice.allocations[0];
    const projectId = slice.projects[0]?.id;
    expect(original).toBeDefined();
    expect(projectId).toBeDefined();
    if (!original || !projectId) throw new Error("expected seeded allocation and project");
    slice.allocations = [
      { ...original, id: "attributed", projectId },
      { ...original, id: "unattributed" },
    ];

    await cacheAccountSlice("a-studio", slice);
    const restored = await readCachedAccountSlice("a-studio");
    expect(restored?.value.allocations.find((row) => row.id === "attributed")?.projectId).toBe(projectId);
    expect(restored?.value.allocations.find((row) => row.id === "unattributed")).not.toHaveProperty("projectId");
  });

  it("does not revoke a live identity scope when a concurrent cached-identity read misses", async () => {
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let releaseEncryption!: () => void;
    const encryptionGate = new Promise<void>((resolve) => {
      releaseEncryption = resolve;
    });
    let reportStarted!: () => void;
    const encryptionStarted = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(async (algorithm, key, data) => {
      reportStarted();
      await encryptionGate;
      return originalEncrypt(algorithm, key, data);
    });

    const liveIdentityWrite = cacheAuthSnapshot(authSnapshot("user-a"));
    await encryptionStarted;
    await expect(readCachedAuthSnapshot()).resolves.toBeNull();
    releaseEncryption();
    await liveIdentityWrite;

    await cacheAccountSlice("a-studio", accountSlice("a-studio"));
    await expect(getRaw(`slice:${currentCacheNamespace()}:user-a:a-studio`)).resolves.toBeDefined();
  });
});
