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
  readCachedAccountSummaries,
  readCachedAuthSnapshot,
  readCachedAccountSlice,
  setOfflineReadEnabled,
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

describe("offline tenant cache retention", () => {
  registerTenantCacheHooks();
  it("physically sweeps every expired envelope when cache maintenance next runs", async () => {
    const savedAt = new Date("2026-07-01T00:00:00.000Z").getTime();
    const clock = vi.spyOn(Date, "now").mockReturnValue(savedAt);
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSummaries([{ id: "a-studio", name: "Studio", role: "owner" }]);
    await cacheAccountSlice("a-studio", accountSlice("a-studio"));
    const origin = currentCacheNamespace();

    clock.mockReturnValue(savedAt + 7 * DAY_MS + 1);
    // A later write opens the cache and performs maintenance; no read of either old key occurs.
    await cacheAuthSnapshot(authSnapshot("user-b"));

    await expect(getRaw(`accounts:${origin}:user-a`)).resolves.toBeUndefined();
    await expect(getRaw(`slice:${origin}:user-a:a-studio`)).resolves.toBeUndefined();
  });

  it("sweeps records that expire less than an hour after the previous connection", async () => {
    const savedAt = new Date("2026-07-01T00:00:00.000Z").getTime();
    const clock = vi.spyOn(Date, "now").mockReturnValue(savedAt);
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSlice("a-studio", accountSlice("a-studio"));
    const origin = currentCacheNamespace();

    clock.mockReturnValue(savedAt + 7 * DAY_MS - 30 * 60 * 1000);
    await cacheAuthSnapshot(authSnapshot("user-b"));

    clock.mockReturnValue(savedAt + 7 * DAY_MS + 1);
    await cacheAuthSnapshot(authSnapshot("user-c"));

    await expect(getRaw(`slice:${origin}:user-a:a-studio`)).resolves.toBeUndefined();
  });

  it("opting out physically removes encrypted records for every prior user", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSummaries([{ id: "a-studio", name: "Studio", role: "owner" }]);
    await cacheAccountSlice("a-studio", accountSlice("a-studio"));
    await cacheAuthSnapshot(authSnapshot("user-b"));
    await cacheAccountSlice("a-studio", emptyAppData());
    const origin = currentCacheNamespace();

    await setOfflineReadEnabled(false);

    expect(isOfflineReadEnabled()).toBe(false);
    await expect(getRaw(`auth:${origin}`)).resolves.toBeUndefined();
    await expect(getRaw(`accounts:${origin}:user-a`)).resolves.toBeUndefined();
    await expect(getRaw(`slice:${origin}:user-a:a-studio`)).resolves.toBeUndefined();
    await expect(getRaw(`slice:${origin}:user-b:a-studio`)).resolves.toBeUndefined();
  });
});

describe("offline tenant cache encryption", () => {
  registerTenantCacheHooks();
  it("stores only authenticated ciphertext and deletes an entry whose tag no longer verifies", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSummaries([{ id: "a-studio", name: "Confidential Studio", role: "owner" }]);
    const key = `accounts:${currentCacheNamespace()}:user-a`;
    const raw = (await getRaw(key)) as {
      key: string;
      savedAt: number;
      version: number;
      iv: ArrayBuffer;
      ciphertext: ArrayBuffer;
      value?: unknown;
    };

    expect(raw.value).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain("Confidential Studio");
    expect(Object.prototype.toString.call(raw.iv)).toBe("[object ArrayBuffer]");
    expect(Object.prototype.toString.call(raw.ciphertext)).toBe("[object ArrayBuffer]");

    const tampered = new Uint8Array(raw.ciphertext).slice();
    if (tampered[0] === undefined) throw new Error("expected encrypted cache bytes");
    tampered[0] ^= 1;
    await putRaw({ ...raw, ciphertext: tampered.buffer });
    await expect(readCachedAccountSummaries()).resolves.toBeNull();
    await expect(getRaw(key)).resolves.toBeUndefined();
  });

  it("keeps the later account directory when an earlier encryption is delayed", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let releaseEarlier!: () => void;
    let reportEarlierStarted!: () => void;
    const earlierGate = new Promise<void>((resolve) => {
      releaseEarlier = resolve;
    });
    const earlierStarted = new Promise<void>((resolve) => {
      reportEarlierStarted = resolve;
    });
    vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(async (algorithm, key, data) => {
      reportEarlierStarted();
      await earlierGate;
      return originalEncrypt(algorithm, key, data);
    });

    const earlier = cacheAccountSummaries([{ id: "old", name: "Older", role: "owner" }]);
    await earlierStarted;
    const later = cacheAccountSummaries([{ id: "new", name: "Newest", role: "owner" }]);
    releaseEarlier();
    await Promise.all([earlier, later]);

    await expect(readCachedAccountSummaries()).resolves.toMatchObject({
      value: [{ id: "new", name: "Newest", role: "owner" }],
    });
  });
});

describe("offline tenant cache transaction failures", () => {
  registerTenantCacheHooks();
  it("rejects when invalid-entry deletion aborts after its request succeeds", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSummaries([{ id: "a-studio", name: "Confidential Studio", role: "owner" }]);
    const key = `accounts:${currentCacheNamespace()}:user-a`;
    const raw = (await getRaw(key)) as { ciphertext: ArrayBuffer };
    const tampered = new Uint8Array(raw.ciphertext).slice();
    if (tampered[0] === undefined) throw new Error("expected encrypted cache bytes");
    tampered[0] ^= 1;
    await putRaw({ ...raw, key, ciphertext: tampered.buffer });

    const originalDelete = FakeIDBObjectStore.prototype.delete;
    vi.spyOn(FakeIDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, query) {
      const request = originalDelete.call(this, query);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Offline cache deletion did not settle.")), 100);
    });
    await expect(Promise.race([readCachedAccountSummaries(), timeout])).rejects.toThrow(
      "Offline cache entry deletion was aborted",
    );
  });

  it("rejects when current-user cleanup aborts after its boundary write succeeds", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const originalPut = FakeIDBObjectStore.prototype.put;
    vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = originalPut.call(this, value, key);
      if ((value as { id?: unknown }).id === "write-boundary-v1") {
        request.addEventListener("success", () => this.transaction.abort());
      }
      return request;
    });

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Offline cache cleanup did not settle.")), 100);
    });
    await expect(Promise.race([clearOfflineDataForCurrentUser(), timeout])).rejects.toThrow(/abort/i);
  });
});

describe("offline tenant cache validation", () => {
  registerTenantCacheHooks();
  it("rejects and deletes an envelope whose timestamp is in the future", async () => {
    const now = new Date("2026-07-01T00:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await putRaw({
      key: `auth:${currentCacheNamespace()}`,
      savedAt: now + 1,
      value: authSnapshot("user-a"),
    });

    await expect(readCachedAuthSnapshot()).resolves.toBeNull();
    await expect(readCachedAuthSnapshot()).resolves.toBeNull();
  });

  it("rejects malformed authentication and account-summary payloads", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    await putEncryptedValue(`auth:${currentCacheNamespace()}`, {
      ...authSnapshot("user-a"),
      authMode: "superuser",
    });
    await expect(readCachedAuthSnapshot()).resolves.toBeNull();
    expect(decrypt).toHaveBeenCalledTimes(1);

    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSummaries([{ id: "a-studio", name: "Studio", role: "owner" }]);
    await putEncryptedValue(`accounts:${currentCacheNamespace()}:user-a`, [
      { id: "a-studio", name: "Studio", role: "superuser" },
    ]);
    await expect(readCachedAccountSummaries()).resolves.toBeNull();
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it("rejects a cached slice containing rows from another account", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    await putEncryptedValue(`slice:${currentCacheNamespace()}:user-a:a-studio`, seed());

    await expect(readCachedAccountSlice("a-studio")).resolves.toBeNull();
    expect(decrypt).toHaveBeenCalledOnce();
  });
});

describe("offline tenant cache identity isolation", () => {
  registerTenantCacheHooks();
  it("never exposes one verified user's account slice to another", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSlice("a-studio", accountSlice("a-studio"));
    await cacheAuthSnapshot(authSnapshot("user-b"));

    await expect(readCachedAccountSlice("a-studio")).resolves.toBeNull();
  });

  it("sign-out clears only the current verified user's cache", async () => {
    await cacheAuthSnapshot(authSnapshot("abc"));
    await cacheAccountSlice("a-studio", accountSlice("a-studio"));
    await cacheAuthSnapshot(authSnapshot("abc2"));
    await cacheAccountSlice("a-studio", emptyAppData());

    await clearOfflineDataForCurrentUser();
    await cacheAuthSnapshot(authSnapshot("abc"));

    expect((await readCachedAccountSlice("a-studio"))?.value.accounts[0]?.name).toBe("Wayne Enterprises");
  });

  it("with no verified scope, sign-out cleanup deletes only the identity key", async () => {
    await clearAllOfflineData();
    const auth = `auth:${currentCacheNamespace()}`;
    const accountKey = `accounts:${currentCacheNamespace()}:user-a`;
    await putRaw({ key: auth, savedAt: Date.now() });
    await putRaw({ key: accountKey, savedAt: Date.now() });

    await clearOfflineDataForCurrentUser();
    await expect(getRaw(auth)).resolves.toBeUndefined();
    await expect(getRaw(accountKey)).resolves.toBeDefined();
  });
});
