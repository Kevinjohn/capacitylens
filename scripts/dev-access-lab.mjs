import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { buildAccessLabEnv } from './access-lab-env.mjs'

const nodeMajor = Number(process.versions.node.split('.')[0])
if (!Number.isInteger(nodeMajor) || nodeMajor < 24) {
  console.error(`dev:access needs Node 24+ — found ${process.versions.node}. Run \`nvm use\` and retry.`)
  process.exit(1)
}

const API_PORT = 8897
const WEB_PORT = 5473
const dbUrl = new URL('../server/.access-lab.db', import.meta.url)
const dbPath = fileURLToPath(dbUrl)

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.destroy()
      resolve(true)
    }).on('error', () => {
      socket.destroy()
      resolve(false)
    })
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

for (const [label, port] of [['API', API_PORT], ['web', WEB_PORT]]) {
  if (await portInUse(port)) {
    console.error(`dev:access ${label} port ${port} is already in use. Stop the existing process and retry.`)
    process.exit(1)
  }
}

for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })

// Keep process essentials such as PATH, but do not let an operator's deployment configuration leak
// into this fixed-credential local lab. In particular, an inherited 0.0.0.0 host, TLS/auth provider,
// reset route, demo seed, or Vite API override could expose it or make the browser talk elsewhere.
const commonEnv = buildAccessLabEnv(process.env, { apiPort: API_PORT, webPort: WEB_PORT })

function spawnPnpm(args, options = {}) {
  return spawn('pnpm', args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: commonEnv,
    ...options,
  })
}

const setup = spawnPnpm(['--filter', 'capacitylens-server', 'exec', 'tsx', 'scripts/setup-access-lab.ts'])
const waitForExit = (child) => new Promise((resolve, reject) => {
  child.on('exit', (code) => resolve(code ?? 1))
  child.on('error', reject)
})
const setupCode = await waitForExit(setup)
if (setupCode !== 0) process.exit(setupCode)

const compileCode = await waitForExit(spawnPnpm(['run', 'paraglide:compile']))
if (compileCode !== 0) process.exit(compileCode)

const children = []
let shuttingDown = false

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) killTree(child)
  process.exit(code)
}

function start(label, args, env = {}) {
  const child = spawn('pnpm', args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    env: { ...commonEnv, ...env },
  })
  children.push(child)
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`dev:access ${label} exited (${signal ? `signal ${signal}` : `code ${code}`}).`)
      shutdown(code ?? 1)
    }
  })
  child.on('error', (error) => {
    console.error(`dev:access failed to launch ${label}: ${error.message}`)
    shutdown(1)
  })
}

console.log(`Access lab: http://127.0.0.1:${WEB_PORT}`)
console.log('Password for every persona: access-lab-password-2026')
start('api', ['--filter', 'capacitylens-server', 'run', 'start'])
start('web', ['exec', 'vite', '--port', String(WEB_PORT)], {
  CAPACITYLENS_DEV_API_PORT: String(API_PORT),
})

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0))
