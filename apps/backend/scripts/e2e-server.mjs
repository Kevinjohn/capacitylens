import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { ports } from '../../../scripts/ports.mjs'

const flavour = process.argv[2]
if (flavour !== 'db' && flavour !== 'auth') {
  console.error('Expected db or auth flavour')
  process.exit(2)
}
const lane = ports()
const database = flavour === 'db' ? '.e2e.db' : '.auth-e2e.db'
for (const suffix of ['', '-wal', '-shm'])
  rmSync(new URL(`../${database}${suffix}`, import.meta.url), { force: true })
const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'error',
  APP_KEY: 'capacitylens-e2e-key-0123456789abcdef',
  APP_URL: `http://127.0.0.1:${flavour === 'db' ? lane.dbApi : lane.authApi}`,
  SESSION_DRIVER: 'memory',
  CAPACITYLENS_DB: database,
  CAPACITYLENS_ALLOW_RESET: '1',
  PORT: String(flavour === 'db' ? lane.dbApi : lane.authApi),
}
const migration = spawnSync(process.execPath, ['ace.js', 'migration:run', '--force'], {
  cwd: new URL('../', import.meta.url),
  env,
  stdio: 'inherit',
})
if (migration.status !== 0) process.exit(migration.status ?? 1)
const seeding = spawnSync(process.execPath, ['ace.js', 'db:seed'], {
  cwd: new URL('../', import.meta.url),
  env,
  stdio: 'inherit',
})
if (seeding.status !== 0) process.exit(seeding.status ?? 1)
const child = spawn(process.execPath, ['ace.js', 'serve'], {
  cwd: new URL('../', import.meta.url),
  env,
  stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) =>
  signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)
)
