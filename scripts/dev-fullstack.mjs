// `pnpm run dev` — the everyday full-stack dev launcher. Server-backed persistence is now the
// app's DEFAULT (empty env = same-origin API; localStorage only under VITE_CAPACITYLENS_DEMO=1),
// so a bare `vite` would boot the app in server-mode against a backend-less dev server (broken).
// This boots BOTH halves and keeps them in lockstep:
//   A) the SQLite API (capacitylens-server, tsx watch on :8787, seeds on first boot), and
//   B) the Vite web server (`dev:web`), whose dev proxy forwards /api → the API port.
// The web app talks to a same-origin /api, exactly like prod behind nginx; the Vite proxy
// (vite.config.ts) is the dev stand-in. For the backend-free localStorage build use `pnpm run
// dev:demo` instead.
//
// NODE 24+: the API uses Node's built-in `node:sqlite`, so full-stack dev needs Node 24 (.nvmrc).
// `pnpm run dev:demo` has no such requirement.
//
//   node scripts/dev-fullstack.mjs   # = pnpm run dev

import { spawn } from 'node:child_process'
import net from 'node:net'

// Keep the launcher, the API child (server reads PORT), and the Vite proxy on the SAME port.
// vite.config.ts's proxy target MUST use the same `CAPACITYLENS_DEV_API_PORT ?? 8787` default so the
// launcher and the Vite proxy stay in lockstep (the 8787 is the shared default, not a copy to drift).
// NB this is the DEV-proxy API port, distinct from serve-dist.mjs's bare API_PORT (its dist-serving port).
const API_PORT = Number(process.env.CAPACITYLENS_DEV_API_PORT ?? 8787)
// Vite is strictPort:true on 5173 (vite.config.ts), so a collision there is a hard EADDRINUSE AFTER
// the API child has already booted. Pre-flight it too (below), symmetric with the API check.
const WEB_PORT = 5173

/**
 * Resolve true iff something is already listening on 127.0.0.1:port. A short-lived connect probe —
 * no new dependency. We surface a collision as a hard error rather than letting the API child fail
 * with a confusing EADDRINUSE deep in tsx, or (worse) silently reuse a stale/foreign server.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net
      .connect({ host: '127.0.0.1', port }, () => {
        socket.destroy()
        resolve(true)
      })
      .on('error', () => {
        socket.destroy()
        resolve(false)
      })
    // Don't hang the launcher if the probe never resolves (e.g. a host that blackholes the port).
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

if (await portInUse(API_PORT)) {
  console.error(
    `dev: port ${API_PORT} is already in use — the API can't start. Stop whatever holds it ` +
      `(another \`pnpm run dev\`, a stray capacitylens-server), or set CAPACITYLENS_DEV_API_PORT ` +
      `to a free port. Not starting the web server to avoid a half-up stack.`,
  )
  process.exit(1)
}

// Symmetric with the API check above: Vite is strictPort:true on WEB_PORT, so a collision is a hard
// EADDRINUSE — but it would surface only AFTER the API child booted, leaving a half-up stack. Catch it
// here, BEFORE starting either child, so neither runs against an unusable web port.
if (await portInUse(WEB_PORT)) {
  console.error(
    `dev: port ${WEB_PORT} is already in use — the Vite web server can't start (strictPort). Stop ` +
      `whatever holds it (another \`pnpm run dev\`/\`pnpm run dev:demo\`, a sibling repo on the same ` +
      `port). Not starting the API server to avoid a half-up stack.`,
  )
  process.exit(1)
}

// shell:true so `pnpm` resolves on Windows (pnpm is pnpm.cmd there); mirrors scripts/e2e-*.mjs.
const children = []
let shuttingDown = false

/**
 * SIGTERM a child's WHOLE process group, not just the immediate `pnpm`. With `shell:true` each child
 * is a shell → pnpm → node(vite/tsx) tree; signalling only the shell leaves vite/tsx orphaned holding
 * :5173/:8787. `detached:true` (below) makes each child a group leader, so a negative-pid kill
 * reaches the whole tree. ESRCH (group already gone) is fine; Windows has no POSIX groups, so fall
 * back to `taskkill /T` which walks the tree there.
 */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGTERM')
    }
  } catch (err) {
    if (err.code !== 'ESRCH') throw err
  }
}

/** Tear down every still-running child, then exit. Idempotent (first caller wins). */
function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) killTree(child)
  process.exit(code)
}

function start(label, args, env) {
  const child = spawn('pnpm', args, {
    // Ignore stdin (inherit stdout/stderr): with detached:true the child is outside the terminal's
    // foreground group, so handing it the TTY stdin risks SIGTTIN and trips Vite's stdin-EOF→SIGTERM
    // shortcut handler. Neither tsx-watch nor Vite needs interactive stdin under this launcher.
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: true,
    // Own process group so shutdown() can SIGTERM the whole shell→pnpm→node tree (see killTree).
    detached: true,
    env: { ...process.env, ...env },
  })
  children.push(child)
  // Either child exiting tears the WHOLE stack down — a dead API or a dead web server both mean
  // dev is broken, and we never leave the survivor orphaned.
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`dev: ${label} exited (${signal ? `signal ${signal}` : `code ${code}`}); shutting down.`)
    shutdown(code ?? 1)
  })
  child.on('error', (err) => {
    if (shuttingDown) return
    console.error(`dev: failed to launch ${label}: ${err.message}`)
    shutdown(1)
  })
  return child
}

// A) SQLite API on API_PORT (server reads PORT). B) Vite web server with its /api proxy.
// CAPACITYLENS_SEED_DEMO + CAPACITYLENS_MULTI_ACCOUNT keep dev batteries-included: the demo seed
// ships TWO companies, and the server's default single-company cap (see server/src/app.ts's
// AppOptions.multiAccount) would otherwise refuse the second one on every fresh dev DB.
start('api', ['--filter', 'capacitylens-server', 'run', 'dev'], {
  PORT: String(API_PORT),
  CAPACITYLENS_SEED_DEMO: '1',
  CAPACITYLENS_MULTI_ACCOUNT: '1',
})
start('web', ['run', 'dev:web'], { CAPACITYLENS_DEV_API_PORT: String(API_PORT) })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0))
}
