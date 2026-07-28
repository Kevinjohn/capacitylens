const SHELL_CACHE_PREFIX = "capacitylens-shell-";
const SHELL_METADATA_CACHE = "capacitylens-offline-shell-metadata-v1";
const ACTIVE_SHELL_POINTER = "/__capacitylens-offline/active-shell";
const PENDING_SHELL_POINTER = "/__capacitylens-offline/pending-shell";

function newShellCacheName() {
  const bytes = crypto.getRandomValues(new Uint32Array(4));
  const installationId = [...bytes].map((value) => value.toString(16).padStart(8, "0")).join("");
  return `${SHELL_CACHE_PREFIX}${installationId}`;
}

async function readShellPointer(metadata, key) {
  const response = await metadata.match(key);
  if (!response) return null;
  const cacheName = await response.text();
  return cacheName.startsWith(SHELL_CACHE_PREFIX) ? cacheName : null;
}

async function deletePointerIfItNames(metadata, key, cacheName) {
  if ((await readShellPointer(metadata, key)) === cacheName) await metadata.delete(key);
}

async function stageShell() {
  const cacheName = newShellCacheName();
  let metadata = null;
  try {
    const index = await fetch("/", { cache: "no-store" });
    if (!index.ok) throw new Error(`Could not cache the CapacityLens shell (${index.status}).`);
    const html = await index.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)]
      .map((match) => match[1])
      .filter((path) => !path.startsWith("/api/"));

    const cache = await caches.open(cacheName);
    // Keep the active release untouched until every new asset is available. Cache.addAll may have
    // written a partial set before rejecting, so a failed installation deletes this private cache.
    await cache.addAll([...new Set(assets)]);
    await cache.put("/", index);

    metadata = await caches.open(SHELL_METADATA_CACHE);
    await metadata.put(PENDING_SHELL_POINTER, new Response(cacheName));
    await self.skipWaiting();
  } catch (error) {
    await caches.delete(cacheName);
    if (metadata) await deletePointerIfItNames(metadata, PENDING_SHELL_POINTER, cacheName);
    throw error;
  }
}

async function activateShell() {
  const metadata = await caches.open(SHELL_METADATA_CACHE);
  const pendingCacheName = await readShellPointer(metadata, PENDING_SHELL_POINTER);
  const activeCacheName = await readShellPointer(metadata, ACTIVE_SHELL_POINTER);
  const cacheName = pendingCacheName ?? activeCacheName;
  const cacheNames = await caches.keys();

  if (!cacheName || !cacheNames.includes(cacheName)) {
    throw new Error("The staged CapacityLens shell is unavailable.");
  }
  const shell = await caches.open(cacheName);
  if (!(await shell.match("/"))) throw new Error("The staged CapacityLens shell is incomplete.");

  // Publishing the pointer is the promotion boundary. Deleting old versions afterwards is safe to
  // retry and ensures a terminated activation can still serve one complete release, never a mix.
  if (pendingCacheName) {
    await metadata.put(ACTIVE_SHELL_POINTER, new Response(cacheName));
    await metadata.delete(PENDING_SHELL_POINTER);
  }
  await self.clients.claim();
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== cacheName)
      .map((name) => caches.delete(name)),
  );
}

async function activeShellCache() {
  const metadata = await caches.open(SHELL_METADATA_CACHE);
  const cacheName = await readShellPointer(metadata, ACTIVE_SHELL_POINTER);
  if (!cacheName || !(await caches.keys()).includes(cacheName)) return null;
  return caches.open(cacheName);
}

self.addEventListener("install", (event) => {
  event.waitUntil(stageShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activateShell());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        // Route URLs can contain invite or password-reset bearer tokens. The immutable installation
        // shell is stored and read under the neutral key only; navigation URLs never become keys.
        const cache = await activeShellCache();
        const index = await cache?.match("/");
        if (index) return index;
        return new Response("CapacityLens is unavailable offline on this device.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }),
    );
    return;
  }

  // Only static shell assets are durable. Other same-origin GETs stay network-only, preventing an
  // accidental future download or token-bearing route from being retained by this broad worker.
  if (!["script", "style", "image", "font", "manifest"].includes(request.destination)) return;
  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await activeShellCache();
      const cached = await cache?.match(request);
      return cached ?? new Response("", { status: 504 });
    }),
  );
});
