import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { join } from "node:path";
import { cwd } from "node:process";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = "https://capacitylens.test";
const SHELL_CACHE_PREFIX = "capacitylens-shell-";
const SHELL_METADATA_CACHE = "capacitylens-offline-shell-metadata-v1";
const ACTIVE_SHELL_POINTER = "/__capacitylens-offline/active-shell";
const PENDING_SHELL_POINTER = "/__capacitylens-offline/pending-shell";
const SHELL_MANIFEST = "/offline-shell.json";
const WORKER_SOURCE = readFileSync(join(cwd(), "public/offline-worker.js"), "utf8");

function cacheKey(input: string | Request): string {
  return new URL(typeof input === "string" ? input : input.url, ORIGIN).href;
}

function requestPath(input: string | Request): string {
  return new URL(typeof input === "string" ? input : input.url, ORIGIN).pathname;
}

class MemoryCache {
  private readonly records = new Map<string, Response>();
  private readonly fetchImpl: (input: string | Request) => Promise<Response>;

  constructor(fetchImpl: (input: string | Request) => Promise<Response>) {
    this.fetchImpl = fetchImpl;
  }

  async addAll(inputs: Array<string | Request>): Promise<void> {
    // Deliberately retain earlier entries when a later fetch fails. This exercises the worker's
    // cleanup even with a Cache implementation that exposes a partially populated failed batch.
    for (const input of inputs) {
      const response = await this.fetchImpl(input);
      if (!response.ok) throw new Error(`Could not cache ${cacheKey(input)} (${response.status}).`);
      await this.put(input, response);
    }
  }

  async delete(input: string | Request): Promise<boolean> {
    return this.records.delete(cacheKey(input));
  }

  async match(input: string | Request): Promise<Response | undefined> {
    return this.records.get(cacheKey(input))?.clone();
  }

  async put(input: string | Request, response: Response): Promise<void> {
    this.records.set(cacheKey(input), response.clone());
  }
}

class MemoryCacheStorage {
  private readonly stores = new Map<string, MemoryCache>();
  private readonly fetchImpl: (input: string | Request) => Promise<Response>;

  constructor(fetchImpl: (input: string | Request) => Promise<Response>) {
    this.fetchImpl = fetchImpl;
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async open(name: string): Promise<MemoryCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new MemoryCache(this.fetchImpl);
      this.stores.set(name, cache);
    }
    return cache;
  }
}

type WorkerEvent = {
  request?: Request;
  respondWith?: (response: Promise<Response>) => void;
  waitUntil?: (work: Promise<unknown>) => void;
};
type WorkerListener = (event: WorkerEvent) => void;

function workerHarness(fetchImpl: (input: string | Request) => Promise<Response>) {
  const caches = new MemoryCacheStorage(fetchImpl);
  const listeners = new Map<string, WorkerListener>();
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);
  const self = {
    location: { origin: ORIGIN },
    clients: { claim },
    skipWaiting,
    addEventListener: (type: string, listener: WorkerListener) => listeners.set(type, listener),
  };

  runInNewContext(
    WORKER_SOURCE,
    {
      caches,
      crypto: webcrypto,
      fetch: fetchImpl,
      Response,
      self,
      Uint32Array,
      URL,
    },
    { filename: "offline-worker.js" },
  );

  return {
    caches,
    claim,
    skipWaiting,
    async dispatch(type: "install" | "activate"): Promise<void> {
      const listener = listeners.get(type);
      if (!listener) throw new Error(`Missing ${type} listener.`);
      let work: Promise<unknown> | null = null;
      listener({
        waitUntil: (value) => {
          work = Promise.resolve(value);
        },
      });
      if (!work) throw new Error(`${type} did not register lifecycle work.`);
      await work;
    },
    async dispatchFetch(request: Request): Promise<Response | null> {
      const listener = listeners.get("fetch");
      if (!listener) throw new Error("Missing fetch listener.");
      let response: Promise<Response> | null = null;
      listener({
        request,
        respondWith: (value) => {
          response = Promise.resolve(value);
        },
      });
      return response ? await response : null;
    },
  };
}

async function seedActiveShell(caches: MemoryCacheStorage, name: string): Promise<MemoryCache> {
  const shell = await caches.open(name);
  await shell.put("/", new Response('<script src="/assets/old.js"></script>'));
  await shell.put("/assets/old.js", new Response("old bundle"));
  const metadata = await caches.open(SHELL_METADATA_CACHE);
  await metadata.put(ACTIVE_SHELL_POINTER, new Response(name));
  return shell;
}

async function pointer(caches: MemoryCacheStorage, key: string): Promise<string | null> {
  const metadata = await caches.open(SHELL_METADATA_CACHE);
  return (await (await metadata.match(key))?.text()) ?? null;
}

describe("offline service-worker shell upgrades", () => {
  it("does not intercept API requests", async () => {
    const fetchImpl = vi.fn(async () => new Response("network"));
    const worker = workerHarness(fetchImpl);

    await expect(worker.dispatchFetch(new Request(`${ORIGIN}/api/accounts`))).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves the neutral cached shell when an offline navigation fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const worker = workerHarness(fetchImpl);
    await seedActiveShell(worker.caches, `${SHELL_CACHE_PREFIX}active-release`);
    const request = new Request(`${ORIGIN}/invite/secret-token`);
    Object.defineProperty(request, "mode", { value: "navigate" });

    const response = await worker.dispatchFetch(request);

    expect(await response?.text()).toContain("/assets/old.js");
  });

  it("leaves the active shell unchanged when a new asset cannot be staged", async () => {
    const fetchImpl = vi.fn(async (input: string | Request) => {
      const path = requestPath(input);
      if (path === "/") {
        return new Response(
          '<link href="/assets/present.css" rel="stylesheet"><script src="/assets/missing.js"></script>',
        );
      }
      if (path === SHELL_MANIFEST) return Response.json([]);
      if (path === "/assets/present.css") return new Response("new styles");
      throw new Error("new asset unavailable");
    });
    const worker = workerHarness(fetchImpl);
    const oldCacheName = `${SHELL_CACHE_PREFIX}old-release`;
    const oldShell = await seedActiveShell(worker.caches, oldCacheName);

    await expect(worker.dispatch("install")).rejects.toThrow("new asset unavailable");

    expect(await pointer(worker.caches, ACTIVE_SHELL_POINTER)).toBe(oldCacheName);
    expect(await pointer(worker.caches, PENDING_SHELL_POINTER)).toBeNull();
    expect(await (await oldShell.match("/"))?.text()).toContain("/assets/old.js");
    expect(await (await oldShell.match("/assets/old.js"))?.text()).toBe("old bundle");
    expect((await worker.caches.keys()).filter((name) => name.startsWith(SHELL_CACHE_PREFIX))).toEqual([oldCacheName]);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it("promotes a complete private shell before deleting the prior release", async () => {
    const fetchImpl = vi.fn(async (input: string | Request) => {
      const path = requestPath(input);
      if (path === "/") return new Response('<script src="/assets/new.js"></script>');
      if (path === SHELL_MANIFEST) return Response.json(["/assets/lazy-route.js"]);
      if (path === "/assets/new.js") return new Response("new bundle");
      if (path === "/assets/lazy-route.js") return new Response("lazy route");
      throw new Error(`Unexpected request for ${path}`);
    });
    const worker = workerHarness(fetchImpl);
    const oldCacheName = `${SHELL_CACHE_PREFIX}old-release`;
    await seedActiveShell(worker.caches, oldCacheName);

    await worker.dispatch("install");

    const stagedCacheName = await pointer(worker.caches, PENDING_SHELL_POINTER);
    expect(stagedCacheName).toMatch(/^capacitylens-shell-[0-9a-f]{32}$/);
    expect(await pointer(worker.caches, ACTIVE_SHELL_POINTER)).toBe(oldCacheName);
    expect(await worker.caches.keys()).toContain(oldCacheName);
    expect(worker.skipWaiting).toHaveBeenCalledOnce();

    await worker.dispatch("activate");

    expect(await pointer(worker.caches, ACTIVE_SHELL_POINTER)).toBe(stagedCacheName);
    expect(await pointer(worker.caches, PENDING_SHELL_POINTER)).toBeNull();
    expect(await worker.caches.keys()).not.toContain(oldCacheName);
    const activeShell = await worker.caches.open(stagedCacheName!);
    expect(await (await activeShell.match("/"))?.text()).toContain("/assets/new.js");
    expect(await (await activeShell.match("/assets/new.js"))?.text()).toBe("new bundle");
    expect(await (await activeShell.match("/assets/lazy-route.js"))?.text()).toBe("lazy route");
    expect(await (await activeShell.match(SHELL_MANIFEST))?.json()).toEqual(["/assets/lazy-route.js"]);
    expect(worker.claim).toHaveBeenCalledOnce();
  });
});
