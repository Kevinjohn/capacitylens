import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const image = 'ghcr.io/dexidp/dex:v2.45.1@sha256:8499afd690c437f52301efd2b05b2455da5bd2dfc20332cd697dc9937f808462'
const container = `capacitylens-oidc-e2e-${process.pid}`
const config = fileURLToPath(new URL('../e2e/oidc/dex.yaml', import.meta.url))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`)
}

async function waitForDiscovery() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:5556/dex/.well-known/openid-configuration', {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
    } catch {
      // The container is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Dex did not publish OIDC discovery metadata within 30 seconds.')
}

try {
  run('docker', [
    'run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1:5556:5556',
    '--volume', `${config}:/etc/dex/config.yaml:ro`,
    image, 'dex', 'serve', '/etc/dex/config.yaml',
  ])
  await waitForDiscovery()
  run('pnpm', [
    'exec', 'playwright', 'test', 'e2e/oidc.oidc.spec.ts', '--project=oidc-backed',
  ], {
    env: { ...process.env, CAPACITYLENS_OIDC_E2E: '1' },
  })
} finally {
  spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' })
}
