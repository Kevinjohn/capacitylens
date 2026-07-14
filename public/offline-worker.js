const SHELL_CACHE = 'capacitylens-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      const index = await fetch('/')
      if (!index.ok) throw new Error(`Could not cache the CapacityLens shell (${index.status}).`)
      const html = await index.clone().text()
      await cache.put('/', index)
      const assets = [...html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)]
        .map((match) => match[1])
        .filter((path) => !path.startsWith('/api/'))
      await cache.addAll([...new Set(assets)])
      await self.skipWaiting()
    })(),
  )
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('capacitylens-shell-') && name !== SHELL_CACHE)
            .map((name) => caches.delete(name)),
        ),
      ),
      self.clients.claim(),
    ]),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache every successful SPA navigation under the neutral shell key only. Route URLs can
          // contain invite or password-reset bearer tokens and must never become cache keys.
          if (response.ok) {
            event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put('/', response.clone())))
          }
          return response
        })
        .catch(async () => {
          const index = await caches.match('/')
          if (index) return index
          return new Response('CapacityLens is unavailable offline on this device.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }),
    )
    return
  }

  // Only static shell assets are durable. Other same-origin GETs stay network-only, preventing an
  // accidental future download or token-bearing route from being retained by this broad worker.
  if (!['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) return
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(request, response.clone())))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        return cached ?? new Response('', { status: 504 })
      }),
  )
})
