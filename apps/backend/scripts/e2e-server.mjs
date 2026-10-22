import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { ports } from '../../../scripts/ports.mjs'

const flavour = process.argv[2]
if (flavour !== 'db' && flavour !== 'auth') {
  console.error(`Expected db or auth flavour; received ${JSON.stringify(flavour)}`)
  process.exit(2)
}

const lane = ports()
const port = flavour === 'db' ? lane.dbApi : lane.authApi
const database = flavour === 'db' ? '.e2e.db' : '.auth-e2e.db'
const serverDirectory = new URL('../', import.meta.url)
const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'error',
  APP_KEY: 'capacitylens-e2e-key-0123456789abcdef',
  APP_URL: `http://127.0.0.1:${port}`,
  SESSION_DRIVER: 'database',
  CAPACITYLENS_DB: database,
  CAPACITYLENS_MODE: 'password-only',
  CAPACITYLENS_ALLOW_RESET: '1',
  ...(flavour === 'db' ? { CAPACITYLENS_RATE_LIMIT: '1000' } : {}),
  PORT: String(port),
}

if (flavour === 'auth' || flavour === 'db') {
  Object.assign(env, {
    CAPACITYLENS_MODE: 'password-only',
    // The auth-backed server completes real first-company setup before it creates the
    // membership-free administrator used by recovery/login scenarios.
    CAPACITYLENS_CREATE_ADMIN_ADMIN: flavour === 'auth' ? 'false' : '1',
    CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: flavour === 'auth' ? '' : 'auth-e2e-password-2026',
    CAPACITYLENS_BOOTSTRAP_TOKEN: 'auth-e2e-bootstrap-token-0123456789abcdef',
    CAPACITYLENS_PASSWORD_BREACH_CHECK: 'false',
    CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
    CAPACITYLENS_SECRET: 'capacitylens-auth-e2e-secret-0123456789abcdef',
    CAPACITYLENS_PUBLIC_URL: `http://localhost:${port}`,
    CAPACITYLENS_CORS_ORIGIN: `http://localhost:${lane.authWeb},http://127.0.0.1:${lane.authWeb}`,
  })
}

if (flavour === 'auth') {
  env.CAPACITYLENS_SETUP_TOKEN = 'auth-e2e-first-company-setup-token-2026'
}

for (const suffix of ['', '-wal', '-shm']) {
  rmSync(new URL(`../${database}${suffix}`, import.meta.url), { force: true })
}

function runAce(args) {
  const result = spawnSync(process.execPath, ['ace.js', ...args], {
    cwd: serverDirectory,
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

runAce(['migration:run', '--force'])
if (flavour === 'db') runAce(['db:seed', '--files=database/seeders/main_seeder.ts'])

const child = spawn(process.execPath, ['ace.js', 'serve'], {
  cwd: serverDirectory,
  stdio: 'inherit',
  env,
})
let stopping = false
let childExited = false
const startupController = new AbortController()
const startupTimeout =
  flavour === 'auth'
    ? setTimeout(
        () =>
          startupController.abort(new Error('Auth E2E baseline setup timed out after 20 seconds.')),
        20_000
      )
    : undefined
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    startupController.abort(new Error(`Auth E2E startup interrupted by ${signal}.`))
    child.kill(signal)
  })
}
child.on('exit', (code, signal) => {
  childExited = true
  startupController.abort(new Error('Auth E2E server exited during startup.'))
  if (stopping) return
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})

async function establishAuthFixtureBaseline(signal) {
  const origin = env.CAPACITYLENS_PUBLIC_URL
  const setup = await fetch(`${origin}/api/auth/sign-up`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      'x-capacitylens-setup-token': env.CAPACITYLENS_SETUP_TOKEN,
    },
    signal,
    body: JSON.stringify({
      email: 'baseline-owner@capacitylens.dev',
      name: 'Clark Kent',
      password: 'auth-e2e-password-2026',
    }),
  })
  if (setup.status !== 201)
    throw new Error(`Auth E2E baseline owner setup failed (${setup.status}).`)
  const cookie = setup.headers
    .getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .join('; ')
  if (!cookie) throw new Error('Auth E2E baseline owner setup did not create a session.')

  const company = await fetch(`${origin}/api/installation/company`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'sec-fetch-site': 'same-origin' },
    signal,
    body: JSON.stringify({ name: 'Daily Planet E2E Baseline' }),
  })
  if (company.status !== 201)
    throw new Error(`Auth E2E baseline company setup failed (${company.status}).`)

  const administrator = await fetch(`${origin}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    signal,
    body: JSON.stringify({
      email: 'admin@admin.admin',
      name: 'Bruce Wayne',
      password: 'auth-e2e-password-2026',
    }),
  })
  if (administrator.status !== 201)
    throw new Error(
      `Auth E2E membership-free administrator setup failed (${administrator.status}).`
    )
}

async function waitForAuthFixtureBaseline(signal) {
  let ready = false
  while (!signal.aborted) {
    try {
      ready = (await fetch(`${env.CAPACITYLENS_PUBLIC_URL}/health/ready`, { signal })).ok
    } catch {
      if (signal.aborted) throw signal.reason
      // The listener may not be ready yet; keep polling until the bounded startup deadline.
    }
    if (ready) break
    await delay(100, undefined, { signal })
  }
  if (signal.aborted) throw signal.reason
  if (!ready) throw new Error('Auth E2E server did not become ready for baseline setup.')
  await establishAuthFixtureBaseline(signal)
}

if (flavour === 'auth') {
  try {
    await waitForAuthFixtureBaseline(startupController.signal)
    console.info('Auth E2E fixture ready')
  } catch (error) {
    const startupError = startupController.signal.aborted ? startupController.signal.reason : error
    stopping = true
    startupController.abort(startupError)
    if (!childExited) child.kill('SIGTERM')
    if (!childExited) await new Promise((resolve) => child.once('exit', resolve))
    throw startupError
  } finally {
    clearTimeout(startupTimeout)
  }
}
