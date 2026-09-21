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

/** Simulate host APIs that may throw arbitrary JavaScript values. Generator.throw preserves the
 * exact supplied value without adding a ThrowStatement that production lint correctly rejects. */
function throwHostValue(value: unknown): never {
  const generator = (function* () {
    yield undefined;
  })();
  generator.next();
  generator.throw(value);
  throw new Error("Generator.throw unexpectedly returned.");
}

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

describe("offline tenant cache", () => {
  registerTenantCacheHooks();
  it("reports why writes are skipped instead of resolving ambiguously", async () => {
    localStorage.removeItem("capacitylens/offlineRead");
    await expect(cacheAccountSummaries([])).resolves.toEqual({ kind: "skipped", reason: "disabled" });

    localStorage.setItem("capacitylens/offlineRead", "on");
    await expect(cacheAccountSummaries([])).resolves.toEqual({ kind: "skipped", reason: "unscoped" });
  });

  it("does not repeatedly encrypt an unchanged tenant slice during live refreshes", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const slice = accountSlice("a-studio");

    await expect(cacheAccountSlice("a-studio", slice)).resolves.toEqual({ kind: "written" });
    await expect(cacheAccountSlice("a-studio", structuredClone(slice))).resolves.toEqual({
      kind: "skipped",
      reason: "unchanged",
    });

    const account = slice.accounts[0];
    expect(account).toBeDefined();
    if (account === undefined) throw new Error("Expected the cached account fixture");
    account.updatedAt = "2026-07-30T10:00:00.000Z";
    await expect(cacheAccountSlice("a-studio", slice)).resolves.toEqual({ kind: "written" });
  });
});

describe("offline tenant cache write failures", () => {
  registerTenantCacheHooks();
  it("does not suppress a retry after a failed slice write", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const slice = accountSlice("a-studio");
    const cause = new Error("slice encryption failed");
    vi.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(cause);

    await expect(cacheAccountSlice("a-studio", slice)).rejects.toBe(cause);
    await expect(cacheAccountSlice("a-studio", structuredClone(slice))).resolves.toEqual({ kind: "written" });
    await expect(cacheAccountSlice("a-studio", structuredClone(slice))).resolves.toEqual({
      kind: "skipped",
      reason: "unchanged",
    });
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
    expect(readOfflineStateSnapshot().cacheWriteFailed).toBe(true);
  });
});

describe("offline tenant cache competing keys", () => {
  registerTenantCacheHooks();
  it("uses the device key persisted by a competing tab after add fails", async () => {
    const winner = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const originalGet = FakeIDBObjectStore.prototype.get;
    const originalAdd = FakeIDBObjectStore.prototype.add;
    let keyReads = 0;
    vi.spyOn(FakeIDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, query) {
      if (query !== "device-aes-gcm-v1" || ++keyReads === 1) return originalGet.call(this, query);
      const request = { result: { id: "device-aes-gcm-v1", value: winner }, error: null } as IDBRequest;
      Object.defineProperty(request, "onsuccess", {
        set(callback: ((event: Event) => void) | null) {
          if (callback) queueMicrotask(() => callback(new Event("success")));
        },
      });
      return request;
    });
    vi.spyOn(FakeIDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, value, key) {
      if ((value as { id?: unknown }).id === "device-aes-gcm-v1") {
        throw new Error("constraint");
      }
      return originalAdd.call(this, value, key);
    });

    await expect(cacheAuthSnapshot(authSnapshot("user-a"))).resolves.toEqual({ kind: "written" });
    await expect(readCachedAuthSnapshot()).resolves.toMatchObject({ value: { user: { id: "user-a" } } });
  });

  it("isolates invalid configured API URLs in their own encoded namespace", async () => {
    vi.doMock("./apiConfig", () => ({ API_BASE: "http://[" }));
    vi.resetModules();
    const invalidBackend = await import("./offlineCache");
    await invalidBackend.cacheAuthSnapshot(authSnapshot("invalid-origin-user"));

    await expect(
      getRaw(`auth:${window.location.origin}|api:invalid:${encodeURIComponent("http://[")}`),
    ).resolves.toBeDefined();
    await expect(getRaw(`auth:${currentCacheNamespace()}`)).resolves.toBeUndefined();
    vi.doUnmock("./apiConfig");
  });
});

describe("offline tenant cache unavailable capabilities", () => {
  registerTenantCacheHooks();
  it("fails a scoped read cleanly when IndexedDB disappears", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    vi.stubGlobal("indexedDB", undefined);
    await expect(readCachedAccountSlice("a-studio")).rejects.toThrow("IndexedDB is unavailable");
  });

  it("fails enabling when Web Crypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    vi.stubGlobal("navigator", { serviceWorker: {} });
    await expect(setOfflineReadEnabled(true)).rejects.toThrow("Web Crypto is unavailable");
  });

  it("fails enabling when Web Crypto has no subtle implementation", async () => {
    vi.stubGlobal("crypto", {});
    vi.stubGlobal("navigator", { serviceWorker: {} });
    await expect(setOfflineReadEnabled(true)).rejects.toThrow("Web Crypto is unavailable");
  });

  it("repairs a malformed durable boundary once and then preserves the stored token", async () => {
    await putRawKey({ id: "wrong-id", token: 123 });
    const originalPut = FakeIDBObjectStore.prototype.put;
    const boundaryPuts: unknown[] = [];
    vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if ((value as { id?: unknown }).id === "write-boundary-v1") boundaryPuts.push(value);
      return originalPut.call(this, value, key);
    });
    const activated = workerLifecycle("activated").worker;
    vi.stubGlobal("navigator", {
      serviceWorker: { register: vi.fn().mockResolvedValue({ installing: null, waiting: null, active: activated }) },
    });

    await setOfflineReadEnabled(true);
    const firstToken = localStorage.getItem("capacitylens/offlineWriteBoundary");
    await setOfflineReadEnabled(true);
    expect(firstToken).toEqual(expect.any(String));
    expect(localStorage.getItem("capacitylens/offlineWriteBoundary")).toBe(firstToken);
    expect(boundaryPuts).toHaveLength(1);
  });
});

describe("offline tenant cache durable boundary", () => {
  registerTenantCacheHooks();
  it("surfaces a write-boundary preference read failure and refuses the cache write", async () => {
    await putRawKey({ id: "write-boundary-v1", token: "durable-token" });
    const cause = new Error("getItem blocked");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (key.endsWith("offlineWriteBoundary")) throw cause;
      return "on";
    });

    await expect(cacheAuthSnapshot(authSnapshot("user-a"))).resolves.toEqual({ kind: "written" });
    await expect(getRaw(`auth:${currentCacheNamespace()}`)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      "offlineCache: the offline write boundary could not be read; rejecting cache writes",
      cause,
    );
  });

  it("rejects a write when the durable-boundary request errors", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const originalGet = FakeIDBObjectStore.prototype.get;
    vi.spyOn(FakeIDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, query) {
      if (query === "write-boundary-v1") {
        const request = { error: null } as IDBRequest;
        Object.defineProperty(request, "onerror", {
          set(callback: ((event: Event) => void) | null) {
            if (callback) queueMicrotask(() => callback(new Event("error")));
          },
        });
        return request;
      }
      return originalGet.call(this, query);
    });

    await expect(cacheAccountSummaries([{ id: "a-studio", name: "Studio", role: "owner" }])).rejects.toThrow(
      "The offline write boundary could not be read",
    );
  });

  it("fails closed and warns when the offline preference cannot be read", () => {
    const cause = new Error("getItem blocked");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw cause;
    });

    expect(isOfflineReadEnabled()).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      "offlineCache: the offline preference could not be read; disabling offline access",
      cause,
    );
  });
});

describe("offline tenant cache cleanup boundaries", () => {
  registerTenantCacheHooks();
  it("falls back when randomUUID fails and completes cleanup", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("UUID unavailable");
    });
    await expect(clearAllOfflineData()).resolves.toBeUndefined();
    await expect(getRaw(`auth:${currentCacheNamespace()}`)).resolves.toBeUndefined();
  });

  it("finishes deletion before surfacing a write-boundary storage failure", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const cause = new Error("setItem blocked");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (key.endsWith("offlineWriteBoundary")) throw cause;
    });

    await expect(clearAllOfflineData()).rejects.toBe(cause);
    await expect(getRaw(`auth:${currentCacheNamespace()}`)).resolves.toBeUndefined();
  });

  it("prefers the boundary storage error when IndexedDB is also unavailable", async () => {
    const cause = new Error("setItem blocked");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw cause;
    });
    vi.stubGlobal("indexedDB", undefined);
    await expect(clearOfflineDataForCurrentUser()).rejects.toBe(cause);
  });

  it("surfaces a boundary storage failure after an otherwise successful user cleanup", async () => {
    await cacheAuthSnapshot(authSnapshot("user-a"));
    const cause = new Error("setItem blocked");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (key.endsWith("offlineWriteBoundary")) throw cause;
    });
    await expect(clearOfflineDataForCurrentUser()).rejects.toBe(cause);
    await expect(getRaw(`auth:${currentCacheNamespace()}`)).resolves.toBeUndefined();
  });
});

describe("offline tenant cache malformed identifiers", () => {
  registerTenantCacheHooks();
  it.each([null, undefined, false, 0, ""])(
    "completes cleanup when storage throws a falsy value (%p)",
    async (cause) => {
      await cacheAuthSnapshot(authSnapshot("user-a"));
      vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
        if (key.endsWith("offlineWriteBoundary")) throwHostValue(cause);
      });

      await expect(clearOfflineDataForCurrentUser()).resolves.toBeUndefined();
      await expect(getRaw(`auth:${currentCacheNamespace()}`)).resolves.toBeUndefined();
    },
  );

  it.each([null, undefined, false, 0, ""])(
    "follows the missing-storage policy when storage throws a falsy value (%p)",
    async (cause) => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throwHostValue(cause);
      });
      vi.stubGlobal("indexedDB", undefined);

      await expect(clearOfflineDataForCurrentUser()).rejects.toThrow("IndexedDB is unavailable");
      await expect(clearAllOfflineData()).resolves.toBeUndefined();
    },
  );
});
