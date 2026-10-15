import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
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
  SESSION_DRIVER: flavour === 'auth' ? 'database' : 'memory',
  CAPACITYLENS_DB: database,
  CAPACITYLENS_MODE: flavour === 'db' ? 'off' : 'password-only',
  CAPACITYLENS_ALLOW_RESET: '1',
  PORT: String(port),
}

if (flavour === 'auth') {
  Object.assign(env, {
    CAPACITYLENS_MODE: 'password-only',
    CAPACITYLENS_CREATE_ADMIN_ADMIN: '1',
    // Keep these fixtures aligned with e2e/authTestSupport.ts.
    CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: 'auth-e2e-password-2026',
    CAPACITYLENS_PASSWORD_BREACH_CHECK: 'false',
    CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
    CAPACITYLENS_MULTI_ACCOUNT: '1',
    CAPACITYLENS_SECRET: 'capacitylens-auth-e2e-secret-0123456789abcdef',
    CAPACITYLENS_PUBLIC_URL: `http://localhost:${port}`,
    CAPACITYLENS_CORS_ORIGIN: `http://localhost:${lane.authWeb},http://127.0.0.1:${lane.authWeb}`,
  })
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
runAce(['db:seed', '--files=database/seeders/main_seeder.ts'])

const child = spawn(process.execPath, ['ace.js', 'serve'], {
  cwd: serverDirectory,
  stdio: 'inherit',
  env,
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
