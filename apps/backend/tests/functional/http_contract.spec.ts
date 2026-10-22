import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { terminateProcessTree } from '../../../../scripts/devProcesses.mjs'

// Proxy trust, HSTS and cookie security are read once at boot, so each case starts its own server.
const backendRoot = new URL('../../', import.meta.url)

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
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers, agent: false })
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
async function withServer(
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
    SESSION_DRIVER: 'database',
    CAPACITYLENS_MODE: 'off',
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
      detached: process.platform !== 'win32',
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

const limitedRead = (server: Booted, forwardedFor: string) =>
  server.send('GET', '/api/meta', { 'x-forwarded-for': forwardedFor }).then(({ status }) => status)

// An http page origin matches its own host only while the request protocol stays http, so a
// forwarded https protocol turns this unsafe request into a cross-origin refusal.
const plainOriginReset = (server: Booted, forwardedProto?: string) =>
  server
    .send('POST', '/api/test/reset', {
      origin: 'http://capacity.example.test',
      host: 'capacity.example.test',
      ...(forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {}),
    })
    .then(({ status }) => status)

const sessionCookie = (reply: Reply) =>
  ([] as string[])
    .concat(reply.headers['set-cookie'] ?? [])
    .find((cookie) => /^(__Host-)?adonis-session=/.test(cookie))

test.group('HTTP proxy, transport and cookie contract', (group) => {
  group.each.timeout(90_000)

  test('untrusted proxy headers: the limiter keys a loopback request by its socket', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'false', CAPACITYLENS_RATE_LIMIT: '1' },
      {},
      async (server) => {
        assert.notEqual(await limitedRead(server, '203.0.113.5'), 429)
        assert.equal(
          await limitedRead(server, '198.51.100.99'),
          429,
          'a different forwarded address from the same socket shares one budget'
        )
      }
    )
  })

  test('trusted proxy headers: the limiter keys a loopback request by the nearest untrusted hop', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'true', CAPACITYLENS_RATE_LIMIT: '1' },
      {},
      async (server) => {
        assert.notEqual(await limitedRead(server, '198.51.100.7, 203.0.113.5'), 429)
        assert.equal(
          await limitedRead(server, '203.0.113.5'),
          429,
          'the chain was keyed by 203.0.113.5'
        )
        assert.notEqual(
          await limitedRead(server, '198.51.100.7'),
          429,
          'the leftmost, client-supplied entry is not the key'
        )
      }
    )
  })

  test('trusted proxy headers: a non-loopback peer cannot supply a forwarded address', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'true', CAPACITYLENS_RATE_LIMIT: '1' },
      { peer: '10.0.0.9' },
      async (server) => {
        assert.notEqual(await limitedRead(server, '203.0.113.5'), 429)
        assert.equal(
          await limitedRead(server, '198.51.100.7'),
          429,
          'both requests are keyed by the peer 10.0.0.9'
        )
      }
    )
  })

  test('trusted proxy headers: the origin guard uses a loopback proxy forwarded protocol', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'true', CAPACITYLENS_ALLOW_RESET: 'true' },
      {},
      async (server) => {
        assert.equal(await plainOriginReset(server), 200)
        assert.equal(
          await plainOriginReset(server, 'https'),
          403,
          'the forwarded https protocol no longer matches the http origin'
        )
      }
    )
  })

  test('untrusted proxy headers: the origin guard ignores a forwarded protocol', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'false', CAPACITYLENS_ALLOW_RESET: 'true' },
      {},
      async (server) => {
        assert.equal(await plainOriginReset(server, 'https'), 200)
      }
    )
  })

  test('trusted proxy headers: a non-loopback peer cannot supply a forwarded protocol', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'true', CAPACITYLENS_ALLOW_RESET: 'true' },
      { peer: '10.0.0.9' },
      async (server) => {
        assert.equal(await plainOriginReset(server, 'https'), 200)
      }
    )
  })

  test('an https public URL sends host-only HSTS for one year', async ({ assert }) => {
    await withServer(
      { CAPACITYLENS_PUBLIC_URL: 'https://capacity.example.test' },
      {},
      async (server) => {
        const reply = await server.send('GET', '/api/health')
        assert.equal(reply.status, 200)
        assert.strictEqual(reply.headers['strict-transport-security'], 'max-age=31536000')
      }
    )
  })

  test('an http public URL sends no HSTS', async ({ assert }) => {
    await withServer({ CAPACITYLENS_PUBLIC_URL: 'http://127.0.0.1' }, {}, async (server) => {
      const reply = await server.send('GET', '/api/health')
      assert.equal(reply.status, 200)
      assert.notProperty(reply.headers, 'strict-transport-security')
    })
  })

  test('an http public URL in production issues a session cookie without Secure', async ({
    assert,
  }) => {
    await withServer(
      {
        NODE_ENV: 'production',
        CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION: 'true',
        CAPACITYLENS_PUBLIC_URL: 'http://127.0.0.1',
      },
      {},
      async (server) => {
        const reply = await server.send('GET', '/api/health')
        assert.equal(reply.status, 200)
        const cookie = sessionCookie(reply)
        assert.isDefined(cookie, `session cookie in ${String(reply.headers['set-cookie'])}`)
        assert.match(cookie!, /^adonis-session=/, 'a __Host- cookie requires Secure')
        assert.notMatch(cookie!, /;\s*secure(;|$)/i)
      }
    )
  })

  test('security headers reach a static file and an unmatched route', async ({ assert }) => {
    await withServer(
      { CAPACITYLENS_PUBLIC_URL: 'https://capacity.example.test' },
      {},
      async (server) => {
        const staticFile = await server.send('GET', '/favicon.svg')
        assert.equal(staticFile.status, 200)
        assert.match(String(staticFile.headers['content-type']), /^image\/svg\+xml/)
        const unmatched = await server.send('PATCH', '/no-such-route')
        assert.equal(unmatched.status, 404)
        for (const [label, reply] of [
          ['static', staticFile],
          ['unmatched', unmatched],
        ] as const) {
          assert.strictEqual(
            reply.headers['strict-transport-security'],
            'max-age=31536000',
            `${label} HSTS`
          )
          assert.equal(reply.headers['x-frame-options'], 'DENY', `${label} frame options`)
          assert.equal(reply.headers['x-content-type-options'], 'nosniff', `${label} sniffing`)
          assert.equal(reply.headers['referrer-policy'], 'no-referrer', `${label} referrer`)
          assert.match(
            String(reply.headers['content-security-policy']),
            /frame-ancestors 'none'/,
            `${label} CSP`
          )
        }
      }
    )
  })
})
