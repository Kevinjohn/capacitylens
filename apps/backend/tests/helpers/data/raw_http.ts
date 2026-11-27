import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { terminateProcessTree } from '@capacitylens/tooling/devProcesses'

const backendRoot = new URL('../../../', import.meta.url)

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
}

interface Booted {
  send(method: string, path: string, headers?: Record<string, string>): Promise<Reply>
}

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

function send(port: number, method: string, path: string, headers: Record<string, string> = {}) {
  return new Promise<Reply>((resolve, reject) => {
    // A fresh connection per request keeps every request's socket address independent.
    const outgoing = httpRequest({ host: '127.0.0.1', port, method, path, headers, agent: false })
    outgoing.on('response', (response) => {
      response.resume()
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, headers: response.headers })
      )
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

/**
 * Boots the real server entry with the given environment. `peer` makes every accepted socket
 * report that remote address, standing in for a connection from another host.
 */
export async function withServer(
  settings: Record<string, string>,
  options: { peer?: string },
  run: (server: Booted) => Promise<void>
) {
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-http-contract-'))
  const port = await freePort()
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('CAPACITYLENS_'))
  )
  const env = {
    ...inherited,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    LOG_LEVEL: 'error',
    APP_KEY: 'capacitylens-test-key-0123456789abcdef',
    APP_URL: `http://127.0.0.1:${port}`,
    CAPACITYLENS_PUBLIC_URL: `http://127.0.0.1:${port}`,
    CAPACITYLENS_DB: join(root, 'contract.db'),
    ...settings,
  }
  const preload: string[] = []
  if (options.peer) {
    const file = join(root, 'peer.mjs')
    writeFileSync(
      file,
      [
        "import net from 'node:net'",
        'const emit = net.Server.prototype.emit',
        'net.Server.prototype.emit = function (event, socket, ...rest) {',
        `  if (event === 'connection') Object.defineProperty(socket, 'remoteAddress', { value: ${JSON.stringify(options.peer)} })`,
        '  return emit.call(this, event, socket, ...rest)',
        '}',
      ].join('\n')
    )
    preload.push(`--import=${file}`)
  }
  const migrated = spawnSync(process.execPath, ['ace.js', 'migration:run', '--force'], {
    cwd: backendRoot,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (migrated.status !== 0) {
    rmSync(root, { recursive: true, force: true })
    throw new Error(`Migration failed: ${migrated.stdout}\n${migrated.stderr}`)
  }
  const child = spawn(
    process.execPath,
    [...preload, '--import=@poppinss/ts-exec', 'bin/server.ts'],
    {
      cwd: backendRoot,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  let output = ''
  const capture = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-12_000)
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)
  try {
    let ready = false
    for (let attempt = 0; attempt < 150 && !ready; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`The server exited before readiness. ${output}`)
      try {
        ready = (await send(port, 'GET', '/health/live').then(({ status }) => status)) === 200
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    if (!ready) throw new Error(`The server did not become ready. ${output}`)
    await run({ send: (method, path, headers) => send(port, method, path, headers) })
  } finally {
    await terminateProcessTree(child, { graceMs: 5000, forceMs: 1000 })
    rmSync(root, { recursive: true, force: true })
  }
}

export const limitedRead = (server: Booted, forwardedFor: string) =>
  server
    .send('GET', '/api/v1/auth/me', { 'x-forwarded-for': forwardedFor })
    .then(({ status }) => status)

interface RawResponse {
  statusCode: number | undefined
  body: string
}

/** Posts raw bytes to the suite's test server, bypassing the API client's body encoding. */
export function postRaw(
  path: string,
  body: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
  cookie?: string
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: Number(process.env.CAPACITYLENS_TEST_HTTP_PORT),
        path,
        method: 'POST',
        headers: {
          'content-type': contentType,
          'content-length': String(body.length),
          'sec-fetch-site': 'same-origin',
          ...(cookie ? { cookie: `adonis-session=${cookie}` } : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    request.on('error', reject)
    request.end(body)
  })
}
