import { spawnSync } from 'node:child_process'
import type { SpawnSyncOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

function run(description: string, command: string, args: string[], options?: SpawnSyncOptions) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${description} failed (${result.status ?? result.signal}).`)
}

/**
 * Generate shared backend client and localization modules, then build the SPA every worker's
 * backend serves, before any worker starts. Building on every run keeps the browser suite on the
 * current source rather than a bundle left over from an earlier build.
 */
export default function globalSetup(): void {
  run('Backend code generation', 'pnpm', ['--dir', 'apps/backend', 'codegen'], {
    // Code generation loads route configuration, which validates the app environment.
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      LOG_LEVEL: 'error',
      APP_KEY: 'capacitylens-e2e-key-0123456789abcdef',
      APP_URL: 'http://localhost',
      CAPACITYLENS_PUBLIC_URL: 'http://localhost',
      CAPACITYLENS_CREATE_ADMIN_ADMIN: '0',
      CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: '',
    },
  })
  run('Paraglide compilation', 'pnpm', ['run', 'paraglide:compile'])
  // Deployment settings from a local environment file must not change what the specs see.
  run(
    'SPA build',
    'pnpm',
    ['--dir', 'apps/frontend', 'exec', 'vite', 'build', '--logLevel', 'warn'],
    {
      env: {
        ...process.env,
        VITE_CAPACITYLENS_BUILD_SHA: '',
        VITE_CAPACITYLENS_FEEDBACK_MAILTO: '',
      },
    }
  )
  run('SPA sync', process.execPath, ['scripts/build/sync-adonisjs-public.mjs'])
}
