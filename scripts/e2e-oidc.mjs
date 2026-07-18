import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const image = 'ghcr.io/dexidp/dex:v2.45.1@sha256:8499afd690c437f52301efd2b05b2455da5bd2dfc20332cd697dc9937f808462'
const container = `capacitylens-oidc-e2e-${process.pid}`
const config = fileURLToPath(new URL('../e2e/oidc/dex.yaml', import.meta.url))
const discovery = 'http://127.0.0.1:5556/dex/.well-known/openid-configuration'
let discoveryFault = 'healthy'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`)
}

async function waitForDiscovery() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(discovery, {
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

const faultProxy = createServer(async (request, response) => {
  if (request.url !== '/dex/.well-known/openid-configuration') {
    response.writeHead(404).end()
    return
  }
  if (discoveryFault === 'unavailable') {
    response.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"unavailable"}')
    return
  }
  if (discoveryFault === 'malformed') {
    response.writeHead(200, { 'content-type': 'application/json' }).end('{malformed')
    return
  }
  try {
    const upstream = await fetch(discovery, { signal: AbortSignal.timeout(2_000) })
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    }).end(Buffer.from(await upstream.arrayBuffer()))
  } catch (error) {
    console.error('OIDC discovery fault proxy could not reach Dex.', error)
    response.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"unavailable"}')
  }
})

async function listenForDiscoveryFaults() {
  await new Promise((resolve, reject) => {
    faultProxy.once('error', reject)
    faultProxy.listen(5557, '127.0.0.1', resolve)
  })
}

async function playwright(filterArgs) {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', [
      'exec', 'playwright', 'test', 'e2e/oidc.oidc.spec.ts', '--project=oidc-backed',
      ...filterArgs,
    ], {
      stdio: 'inherit',
      env: { ...process.env, CAPACITYLENS_OIDC_E2E: '1' },
    })
    child.once('error', reject)
    child.once('exit', (status) => {
      if (status === 0) resolve()
      else reject(new Error(`pnpm exited with status ${status}.`))
    })
  })
}

try {
  run('docker', [
    'run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1:5556:5556',
    '--volume', `${config}:/etc/dex/config.yaml:ro`,
    image, 'dex', 'serve', '/etc/dex/config.yaml',
  ])
  await waitForDiscovery()
  await listenForDiscoveryFaults()
  discoveryFault = 'healthy'
  await playwright(['--grep-invert', '@discovery-fault'])
  discoveryFault = 'malformed'
  await playwright(['--grep', '@malformed-discovery'])
  discoveryFault = 'unavailable'
  await playwright(['--grep', '@unavailable-discovery'])
} finally {
  await new Promise((resolve) => faultProxy.close(resolve))
  spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' })
}
