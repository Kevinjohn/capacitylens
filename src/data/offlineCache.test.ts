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
  offlineReadEnabled,
  offlineStateSnapshot,
  readCachedAccountSummaries,
  readCachedAuthSnapshot,
  readCachedAccountSlice,
  offlineShellAvailable,
  revalidateOfflineShell,
  setOfflineReadEnabled,
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

describe("offline shell availability", () => {
  it("allows production and test builds but rejects on-demand development module graphs", () => {
    expect(offlineShellAvailable({ PROD: true, MODE: "production" })).toBe(true);
    expect(offlineShellAvailable({ PROD: false, MODE: "test" })).toBe(true);
    expect(offlineShellAvailable({ PROD: false, MODE: "development" })).toBe(false);
  });
});

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

async function putRawKey(record: unknown): Promise<void> {
  return putRawInto(KEY_STORE_NAME, record);
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

function workerLifecycle(initial: ServiceWorkerState) {
  let state = initial;
  const worker = new EventTarget();
  Object.defineProperty(worker, "state", { get: () => state });
  return {
    worker: worker as ServiceWorker,
    transition(next: ServiceWorkerState) {
      state = next;
      worker.dispatchEvent(new Event("statechange"));
    },
  };
}

describe("offline preference", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects blocked upgrades and closes connections on late success or version change", async () => {
    const request = {} as IDBOpenDBRequest;
    const close = vi.fn();
    const result = { close } as unknown as IDBDatabase;
    Object.defineProperty(request, "result", {
      value: result,
    });
    vi.stubGlobal("indexedDB", { open: vi.fn(() => request) });
    localStorage.setItem("capacitylens/offlineRead", "on");

    const reading = readCachedAuthSnapshot();
    expect(request.onblocked).toBeTypeOf("function");
    request.onblocked?.(new Event("blocked") as IDBVersionChangeEvent);

    await expect(reading).rejects.toThrow("blocked by another open tab");
    request.onsuccess?.(new Event("success"));
    expect(close).toHaveBeenCalledOnce();
    expect(result.onversionchange).toBeTypeOf("function");
    result.onversionchange?.(new Event("versionchange") as IDBVersionChangeEvent);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("fails closed when this browser cannot install a service worker", async () => {
    vi.stubGlobal("navigator", {});
    await expect(setOfflineReadEnabled(true)).rejects.toThrow("not supported");
    expect(offlineReadEnabled()).toBe(false);
  });

  it("keeps a cached tenant read-only until the tenant boundary itself reloads or cleanup runs", () => {
    setOfflineReadState("tenant", true, 123);

    setOfflineReadState("identity", true, 456);
    setOfflineReadState("identity", false);
    setOfflineReadState("accounts", false);
    expect(offlineStateSnapshot()).toMatchObject({ readOnly: true, lastUpdated: 123 });

    setOfflineReadState("tenant", false);
    expect(offlineStateSnapshot()).toMatchObject({ readOnly: false, lastUpdated: null });
  });

  it("does not leave the preference enabled when worker registration fails", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn().mockRejectedValue(new Error("registration denied")),
      },
    });
    await expect(setOfflineReadEnabled(true)).rejects.toThrow("registration denied");
    expect(offlineReadEnabled()).toBe(false);
  });

  it("enables only after the registered worker finishes activating its shell", async () => {
    const lifecycle = workerLifecycle("installing");
    const register = vi.fn().mockResolvedValue({
      installing: lifecycle.worker,
      waiting: null,
      active: null,
    });
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const enabling = setOfflineReadEnabled(true);
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register).toHaveBeenCalledWith("/offline-worker.js", { scope: "/" });
    expect(offlineReadEnabled()).toBe(false);

    lifecycle.transition("activated");
    await enabling;
    expect(offlineReadEnabled()).toBe(true);
  });

  it("does not enable when shell installation makes the worker redundant", async () => {
    const lifecycle = workerLifecycle("installing");
    const register = vi.fn().mockResolvedValue({
      installing: lifecycle.worker,
      waiting: null,
      active: null,
    });
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const enabling = setOfflineReadEnabled(true);
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());

    lifecycle.transition("redundant");

    await expect(enabling).rejects.toThrow(/installation failed/i);
    expect(offlineReadEnabled()).toBe(false);
  });

  it("keeps an enabled preference only while its worker and active shell cache still exist", async () => {
    localStorage.setItem("capacitylens/offlineRead", "on");
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: vi.fn().mockResolvedValue([
          {
            active: { scriptURL: "https://capacitylens.test/offline-worker.js" },
            waiting: null,
            installing: null,
          },
        ]),
      },
    });
    vi.stubGlobal("caches", {
      open: vi.fn(async (name: string) => ({
        match: vi
          .fn()
          .mockResolvedValue(
            name === "capacitylens-offline-shell-metadata-v1"
              ? new Response("capacitylens-shell-release-a")
              : new Response("<html>shell</html>"),
          ),
      })),
      has: vi.fn().mockResolvedValue(true),
    });

    await expect(revalidateOfflineShell()).resolves.toBe(true);
    expect(offlineReadEnabled()).toBe(true);
  });

  it("disables a stale preference when browser site-data cleanup removed the offline shell", async () => {
    localStorage.setItem("capacitylens/offlineRead", "on");
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([]) },
    });
    vi.stubGlobal("caches", {
      open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) }),
      has: vi.fn().mockResolvedValue(false),
    });

    await expect(revalidateOfflineShell()).resolves.toBe(false);
    expect(offlineReadEnabled()).toBe(false);
  });

  it("deletes shell metadata as well as release caches when offline access is disabled", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: vi.fn().mockResolvedValue([
          {
            active: {
              scriptURL: "https://capacitylens.test/offline-worker.js",
            },
            waiting: null,
            installing: null,
            unregister,
          },
        ]),
      },
    });
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", {
      keys: vi
        .fn()
        .mockResolvedValue([
          "capacitylens-shell-release-a",
          "capacitylens-offline-shell-metadata-v1",
          "unrelated-cache",
        ]),
      delete: deleteCache,
    });

    await setOfflineReadEnabled(false);

    expect(unregister).toHaveBeenCalledOnce();
    expect(deleteCache.mock.calls.map(([name]) => name)).toEqual([
      "capacitylens-shell-release-a",
      "capacitylens-offline-shell-metadata-v1",
    ]);
  });
});

describe("offline tenant cache", () => {
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

  it("reports why writes are skipped instead of resolving ambiguously", async () => {
    localStorage.removeItem("capacitylens/offlineRead");
    await expect(cacheAccountSummaries([])).resolves.toEqual({ status: "skipped", reason: "disabled" });

    localStorage.setItem("capacitylens/offlineRead", "on");
    await expect(cacheAccountSummaries([])).resolves.toEqual({ status: "skipped", reason: "unscoped" });
  });

  it("does not repeatedly encrypt an unchanged tenant slice during live refreshes", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const slice = accountSlice("a-studio");

    await expect(cacheAccountSlice("a-studio", slice)).resolves.toEqual({ status: "written" });
    await expect(cacheAccountSlice("a-studio", structuredClone(slice))).resolves.toEqual({
      status: "skipped",
      reason: "unchanged",
    });

    slice.accounts[0]!.updatedAt = "2026-07-30T10:00:00.000Z";
    await expect(cacheAccountSlice("a-studio", slice)).resolves.toEqual({ status: "written" });
  });

  it("preserves and reports the cause when a generated device key cannot be persisted", async () => {
    const cause = new Error("CryptoKey storage unavailable");
    const originalAdd = FakeIDBObjectStore.prototype.add;
    vi.spyOn(FakeIDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, value, key) {
      if ((value as { id?: unknown }).id === "device-aes-gcm-v1") throw cause;
      return originalAdd.call(this, value, key);
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const failure = await cacheAuthSnapshot(authSnapshot("user-a")).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: "The offline encryption key could not be established.",
      cause,
    });
    expect(warning).toHaveBeenCalledWith("capacitylens: offline encryption key persistence failed", cause);
    expect(offlineStateSnapshot().cacheWriteFailed).toBe(true);
  });

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
    expect(offlineStateSnapshot().readOnly).toBe(false);
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

    expect(offlineReadEnabled()).toBe(false);
    await expect(getRaw(`auth:${origin}`)).resolves.toBeUndefined();
    await expect(getRaw(`accounts:${origin}:user-a`)).resolves.toBeUndefined();
    await expect(getRaw(`slice:${origin}:user-a:a-studio`)).resolves.toBeUndefined();
    await expect(getRaw(`slice:${origin}:user-b:a-studio`)).resolves.toBeUndefined();
  });

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

  it("rejects when invalid-entry deletion aborts after its request succeeds", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    await cacheAccountSummaries([{ id: "a-studio", name: "Confidential Studio", role: "owner" }]);
    const key = `accounts:${currentCacheNamespace()}:user-a`;
    const raw = (await getRaw(key)) as { ciphertext: ArrayBuffer };
    const tampered = new Uint8Array(raw.ciphertext).slice();
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

  it("reports unavailable browser storage so sign-out can disable stale offline data", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const availableIndexedDb = indexedDB;
    vi.stubGlobal("indexedDB", undefined);

    await expect(clearOfflineDataForCurrentUser()).rejects.toThrow("IndexedDB is unavailable");

    // Mirrors AuthProvider's fail-closed fallback. Disabling must remove the preference even when
    // the records cannot currently be reached, and restoring IndexedDB must not make them eligible.
    await setOfflineReadEnabled(false);
    expect(offlineReadEnabled()).toBe(false);
    vi.stubGlobal("indexedDB", availableIndexedDb);
    await expect(readCachedAuthSnapshot()).resolves.toBeNull();
  });

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
    expect(offlineStateSnapshot().cacheWriteFailed).toBe(true);
    await clearAllOfflineData();

    await expect(cacheAuthSnapshot(authSnapshot("user-a"))).resolves.toEqual({ status: "written" });
    expect(offlineStateSnapshot().cacheWriteFailed).toBe(false);
    await expect(readCachedAuthSnapshot()).resolves.toMatchObject({
      value: { user: { id: "user-a" } },
    });
  });
});
