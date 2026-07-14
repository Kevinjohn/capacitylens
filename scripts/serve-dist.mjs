// Production-shaped local server for the Phase 6 rehearsal (docs/runbook.md): serves the
// real Vite build from dist/ and proxies /api/* to the CapacityLens daemon — the same shape
// Nginx gives the droplet (same-origin /api, no CORS in play). Deliberately dependency-
// free and NOT a dev tool: no watch, no transform, no fallback magic beyond the SPA
// index.html rewrite.
//
//   node scripts/serve-dist.mjs   # dist/ on http://127.0.0.1:4173, /api → 127.0.0.1:8787
//   PORT=…  API_PORT=…            # overrides

import { createServer, request as httpRequest } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const PORT = Number(process.env.PORT ?? 4173)
const API_PORT = Number(process.env.API_PORT ?? 8787)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('serve-dist: no dist/index.html — run the production build first (see runbook).')
  process.exit(1)
}

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    // Transparent pass-through to the daemon on loopback, headers and body intact.
    const upstream = httpRequest(
      { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', () => {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end('{"error":"upstream unavailable"}')
    })
    req.pipe(upstream)
    return
  }

  // Static files + SPA fallback, mirroring the packaged nginx.conf's three static blocks:
  //  • `location /assets/ { try_files $uri =404; }` — ONLY under /assets/ does a missing file
  //    404 (hashed bundles are content-addressed; the SPA fallback would mask a broken asset
  //    reference that production nginx rejects).
  //  • `location / { try_files $uri $uri/ /index.html; }` — everywhere else a real file is
  //    served in place and ANY miss (extensioned or not: /favicon.ico, /invite/abc, …) falls
  //    back to index.html so client-side routes resolve.
  //  • `location ~ ^/(invite|reset-password)/ { try_files /index.html =404; }` — also serves
  //    index.html for a miss, so the plain fallback above already matches its response shape
  //    (the access-log redaction it exists for has no analogue here).
  // An earlier version 404'd EVERY missing extensioned path — stricter than nginx, so the
  // rehearsal failed requests (e.g. a missing /favicon.ico) that production serves as the SPA.
  const path = normalize((req.url ?? '/').split('?')[0]).replace(/^([.][.][/\\])+/, '')
  const file = join(DIST, path)
  const isRealFile = existsSync(file) && statSync(file).isFile()
  if (path.startsWith('/assets/') && !isRealFile) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404 not found')
    return
  }
  const target = isRealFile ? file : join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
  createReadStream(target).pipe(res)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serve-dist: http://127.0.0.1:${PORT} (dist/ + /api → 127.0.0.1:${API_PORT})`)
})
