import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDBFactory, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";

import {
  isOfflineReadEnabled,
  readOfflineStateSnapshot,
  readCachedAuthSnapshot,
  revalidateOfflineShell,
  setOfflineReadEnabled,
  setOfflineReadState,
} from "./offlineCache";

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

describe("offline preference", () => {
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

  it("uses the fallback open error when IndexedDB supplies no error", async () => {
    const request = { error: null } as IDBOpenDBRequest;
    vi.stubGlobal("indexedDB", { open: vi.fn(() => request) });
    localStorage.setItem("capacitylens/offlineRead", "on");
    const reading = readCachedAuthSnapshot();
    request.onerror?.(new Event("error"));
    await expect(reading).rejects.toThrow("The offline cache could not be opened");
  });

  it("uses the fallback request error when IndexedDB supplies no read error", async () => {
    const originalGet = FakeIDBObjectStore.prototype.get;
    vi.spyOn(FakeIDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, query) {
      if (String(query).startsWith("auth:")) {
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
    localStorage.setItem("capacitylens/offlineRead", "on");
    await expect(readCachedAuthSnapshot()).rejects.toThrow("The offline cache could not be read");
  });
});

describe("offline preference storage failures", () => {
  it("closes the database and stringifies a non-Error retention-sweep failure", async () => {
    const cursorRequest = { error: "cursor exploded" } as unknown as IDBRequest<IDBCursorWithValue | null>;
    const tx = {
      objectStore: vi.fn(() => ({ openCursor: () => cursorRequest })),
    } as unknown as IDBTransaction;
    const close = vi.fn();
    const db = {
      close,
      transaction: vi.fn(() => tx),
    } as unknown as IDBDatabase;
    const request = { error: null, result: db } as IDBOpenDBRequest;
    vi.stubGlobal("indexedDB", { open: vi.fn(() => request) });
    localStorage.setItem("capacitylens/offlineRead", "on");

    const reading = readCachedAuthSnapshot();
    request.onsuccess?.(new Event("success"));
    cursorRequest.onerror?.(new Event("error"));
    await expect(reading).rejects.toThrow("cursor exploded");
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed when this browser cannot install a service worker", async () => {
    vi.stubGlobal("navigator", {});
    await expect(setOfflineReadEnabled(true)).rejects.toThrow("not supported");
    expect(isOfflineReadEnabled()).toBe(false);
  });

  it("keeps a cached tenant read-only until the tenant boundary itself reloads or cleanup runs", () => {
    setOfflineReadState("tenant", true, 123);

    setOfflineReadState("identity", true, 456);
    setOfflineReadState("identity", false);
    setOfflineReadState("accounts", false);
    expect(readOfflineStateSnapshot()).toMatchObject({ readOnly: true, lastUpdated: 123 });

    setOfflineReadState("tenant", false);
    expect(readOfflineStateSnapshot()).toMatchObject({ readOnly: false, lastUpdated: null });
  });

  it("does not leave the preference enabled when worker registration fails", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn().mockRejectedValue(new Error("registration denied")),
      },
    });
    await expect(setOfflineReadEnabled(true)).rejects.toThrow("registration denied");
    expect(isOfflineReadEnabled()).toBe(false);
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
    expect(isOfflineReadEnabled()).toBe(false);

    lifecycle.transition("activated");
    await enabling;
    expect(isOfflineReadEnabled()).toBe(true);
  });
});

describe("offline preference activation", () => {
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
    expect(isOfflineReadEnabled()).toBe(false);
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
    expect(isOfflineReadEnabled()).toBe(true);
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
    expect(isOfflineReadEnabled()).toBe(false);
  });
});

describe("offline preference cleanup", () => {
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

  it("warns and fails closed when the promised shell cannot be inspected", async () => {
    localStorage.setItem("capacitylens/offlineRead", "on");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("navigator", {});

    await expect(revalidateOfflineShell()).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith(
      "offlineCache: the promised offline shell could not be revalidated",
      expect.any(Error),
    );
    expect(isOfflineReadEnabled()).toBe(false);

    localStorage.setItem("capacitylens/offlineRead", "on");
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([]) } });
    vi.stubGlobal("caches", { open: vi.fn().mockRejectedValue(new Error("cache blocked")) });
    await expect(revalidateOfflineShell()).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith(
      "offlineCache: the promised offline shell could not be revalidated",
      expect.objectContaining({ message: "cache blocked" }),
    );
  });
});

describe("offline preference inspection failures", () => {
  it("surfaces a stale-preference removal failure while still failing closed", async () => {
    localStorage.setItem("capacitylens/offlineRead", "on");
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([]) } });
    vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue({ match: vi.fn() }), has: vi.fn() });
    const cause = new Error("storage blocked");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw cause;
    });

    await expect(revalidateOfflineShell()).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith("offlineCache: the stale offline preference could not be removed", cause);
  });

  it.each([
    ["waiting", "activated"],
    ["active", "activated"],
  ] as const)("accepts an already activated %s worker", async (slot, state) => {
    const lifecycle = workerLifecycle(state);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi
          .fn()
          .mockResolvedValue({ installing: null, waiting: null, active: null, [slot]: lifecycle.worker }),
      },
    });
    await expect(setOfflineReadEnabled(true)).resolves.toBeUndefined();
    expect(isOfflineReadEnabled()).toBe(true);
  });

  it("rejects registrations without a worker and workers already made redundant", async () => {
    const register = vi.fn().mockResolvedValueOnce({ installing: null, waiting: null, active: null });
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    await expect(setOfflineReadEnabled(true)).rejects.toThrow("did not provide a service worker");

    register.mockResolvedValueOnce({
      installing: null,
      waiting: null,
      active: workerLifecycle("redundant").worker,
    });
    await expect(setOfflineReadEnabled(true)).rejects.toThrow("failed before activation");
  });
});

describe("offline preference worker failures", () => {
  it("times out a worker that never activates", async () => {
    const lifecycle = workerLifecycle("installing");
    const realSetTimeout = globalThis.setTimeout;
    let activationTimeout!: () => void;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler, delay?: number) => {
      if (delay === 30_000) {
        activationTimeout = callback as () => void;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(callback, delay);
    }) as typeof setTimeout);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn().mockResolvedValue({ installing: lifecycle.worker, waiting: null, active: null }),
      },
    });
    const enabling = setOfflineReadEnabled(true);
    await vi.waitFor(() => expect(activationTimeout).toBeTypeOf("function"));
    activationTimeout();
    await expect(enabling).rejects.toThrow("did not finish in time");
  });

  it("warns when failed-enable cleanup cannot remove the preference and rethrows the original error", async () => {
    const original = new Error("registration denied");
    const cleanup = new Error("preference locked");
    vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn().mockRejectedValue(original) } });
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw cleanup;
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(setOfflineReadEnabled(true)).rejects.toBe(original);
    expect(removeItem).toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith("offlineCache: failed to clean up after offline enablement failed", cleanup);
  });

  it("leaves the preference disabled when browser cleanup itself fails", async () => {
    localStorage.setItem("capacitylens/offlineRead", "on");
    const cause = new Error("IndexedDB clear blocked");
    vi.spyOn(FakeIDBObjectStore.prototype, "clear").mockImplementation(() => {
      throw cause;
    });

    await expect(setOfflineReadEnabled(false)).rejects.toThrow(/abort/i);
    expect(isOfflineReadEnabled()).toBe(false);
  });
});
