// Production-shaped local server for the Phase 6 rehearsal (docs/runbook.md): serves the
// real Vite build from dist/ and proxies /api/* to the CapacityLens daemon — the same shape
// Nginx gives the droplet (same-origin /api, no CORS in play). Deliberately dependency-
// free and NOT a dev tool: no watch, no transform, no fallback magic beyond the SPA
// index.html rewrite.
//
//   node scripts/serve-dist.mjs   # dist/ on http://127.0.0.1:4173, /api → 127.0.0.1:8787
//   PORT=…  API_PORT=…            # overrides

import { createServer, request as httpRequest } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePort } from './port.mjs'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const PORT = parsePort(process.env.PORT, 4173, 'PORT')
const API_PORT = parsePort(process.env.API_PORT, 8787, 'API_PORT')

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
        up.on('error', (error) => {
          console.error('serve-dist: upstream response failed', error)
          if (res.headersSent) res.destroy(error)
          else {
            res.writeHead(502, { 'content-type': 'application/json' })
            res.end('{"error":"upstream unavailable"}')
          }
        })
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', (error) => {
      if (res.headersSent) res.destroy(error)
      else {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end('{"error":"upstream unavailable"}')
      }
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
  // createReadStream can open a directory and emit EISDIR only after its `open` event. Avoid
  // committing a 200 for the dist directory at GET /; the SPA root is index.html.
  const requested = path === '/' ? join(DIST, 'index.html') : join(DIST, path)
  const serve = (target, fallbackAllowed) => {
    const stream = createReadStream(target)
    stream.once('open', () => {
      res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
      stream.pipe(res)
    })
    stream.on('error', (error) => {
      if (res.headersSent) {
        res.destroy(error)
      } else if (fallbackAllowed) {
        serve(join(DIST, 'index.html'), false)
      } else {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('404 not found')
      }
    })
  }
  serve(requested, !path.startsWith('/assets/'))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serve-dist: http://127.0.0.1:${PORT} (dist/ + /api → 127.0.0.1:${API_PORT})`)
})
