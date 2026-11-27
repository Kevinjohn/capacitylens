import assert from 'node:assert/strict'
import { createServer, get as httpGet, request as httpRequest } from 'node:http'
import { PassThrough } from 'node:stream'
import test, { afterEach, mock } from 'node:test'
import { createRehearsalRequestHandler } from './serve-dist.mjs'

const servers = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(() => resolve())))
  )
})

async function listen(handler) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no TCP port')
  return { server, port: address.port }
}

const requestText = (port, path) =>
  new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    }).on('error', reject)
  })

const argumentsOf = (fn) => fn.mock.calls.map((call) => call.arguments)

test('serve-dist times out an upstream that accepts a request but never sends headers', async () => {
  let upstreamClosed
  const upstream = await listen((request) => {
    upstreamClosed = new Promise((resolve) => request.once('close', resolve))
  })
  const report = mock.fn()
  const proxy = await listen(
    createRehearsalRequestHandler({ apiPort: upstream.port, upstreamTimeoutMs: 30, report })
  )

  assert.deepEqual(await requestText(proxy.port, '/api/health'), {
    status: 504,
    body: '{"error":"upstream timeout"}',
  })
  await upstreamClosed
  assert.ok(
    argumentsOf(report).some(
      ([message, error]) =>
        message === 'serve-dist: upstream request failed' && error instanceof Error
    )
  )
})

test('serve-dist destroys the upstream leg when the downstream client disconnects', async () => {
  let markReceived
  const upstreamReceived = new Promise((resolve) => (markReceived = resolve))
  let upstreamClosed
  const upstream = await listen((request) => {
    markReceived()
    upstreamClosed = new Promise((resolve) => request.once('close', resolve))
  })
  const proxy = await listen(
    createRehearsalRequestHandler({ apiPort: upstream.port, upstreamTimeoutMs: 1_000 })
  )
  const request = httpRequest({ host: '127.0.0.1', port: proxy.port, path: '/api/health' })
  request.on('error', () => undefined)
  request.end()
  await upstreamReceived
  request.destroy()

  await upstreamClosed
})

test('serve-dist aborts a stalled mid-body response and releases the upstream socket', async () => {
  let upstreamClosed
  const upstream = await listen((request, response) => {
    upstreamClosed = new Promise((resolve) => request.once('close', resolve))
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.write('partial')
  })
  const proxy = await listen(
    createRehearsalRequestHandler({
      apiPort: upstream.port,
      upstreamTimeoutMs: 30,
      report: () => undefined,
    })
  )

  await new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port: proxy.port, path: '/api/stalled' }, (response) => {
      response.on('aborted', resolve)
      response.on('error', resolve)
      response.on('end', () => reject(new Error('stalled response ended successfully')))
      response.resume()
    }).on('error', reject)
  })
  await upstreamClosed
})

test('serve-dist keeps genuine misses as 404 without hiding an unexpected stat fault', async () => {
  const missingError = Object.assign(new Error('missing'), { code: 'ENOENT' })
  const missingReport = mock.fn()
  const missing = await listen(
    createRehearsalRequestHandler({
      dist: '/dist',
      statPath: async () => Promise.reject(missingError),
      report: missingReport,
    })
  )
  assert.equal((await requestText(missing.port, '/assets/missing.js')).status, 404)
  assert.equal(missingReport.mock.callCount(), 0)

  const directory = await listen(
    createRehearsalRequestHandler({
      dist: '/dist',
      statPath: async () => ({ isFile: () => false }),
      report: missingReport,
    })
  )
  assert.equal((await requestText(directory.port, '/assets/directory.js')).status, 404)
  assert.equal(missingReport.mock.callCount(), 0)

  const fault = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  const faultReport = mock.fn()
  const broken = await listen(
    createRehearsalRequestHandler({
      dist: '/dist',
      statPath: async () => Promise.reject(fault),
      report: faultReport,
    })
  )
  assert.equal((await requestText(broken.port, '/assets/app.js')).status, 500)
  assert.ok(
    argumentsOf(faultReport).some(
      ([message, error]) => message === 'serve-dist: static file failed' && error === fault
    )
  )
})

test('serve-dist serves the SPA shell for extensionless routes while preserving asset and API 404s', async () => {
  const missingError = Object.assign(new Error('missing'), { code: 'ENOENT' })
  const openShell = () => {
    const stream = new PassThrough()
    queueMicrotask(() => {
      stream.emit('open')
      stream.end('<!doctype html><title>CapacityLens</title>')
    })
    return stream
  }
  const upstream = await listen((_request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"Not found"}')
  })
  const rehearsal = await listen(
    createRehearsalRequestHandler({
      dist: '/dist',
      apiPort: upstream.port,
      statPath: async (target) => {
        if (String(target).endsWith('/index.html')) return { isFile: () => true }
        throw missingError
      },
      openFile: openShell,
    })
  )

  for (const path of [
    '/resources',
    '/disciplines',
    '/clients',
    '/projects',
    '/activities',
    '/timeoff',
    '/team',
    '/settings',
    '/stale-bookmark-that-does-not-exist',
  ]) {
    assert.deepEqual(await requestText(rehearsal.port, path), {
      status: 200,
      body: '<!doctype html><title>CapacityLens</title>',
    })
  }
  assert.deepEqual(await requestText(rehearsal.port, '/assets/missing.js'), {
    status: 404,
    body: '404 not found',
  })
  assert.deepEqual(await requestText(rehearsal.port, '/api/missing'), {
    status: 404,
    body: '{"error":"Not found"}',
  })
})

test('serve-dist refuses request targets that resolve outside dist before touching the filesystem', () => {
  // Node's HTTP parser rejects relative targets, so drive the handler directly as another server could.
  const statPath = mock.fn(async () => ({ isFile: () => true }))
  const serveRequest = createRehearsalRequestHandler({ dist: '/dist', statPath })

  for (const url of ['../outside.txt', '../../etc/passwd', 'a/../../outside.txt']) {
    const res = { writeHead: mock.fn(), end: mock.fn(), headersSent: false }
    serveRequest({ url, method: 'GET', headers: {} }, res)
    assert.ok(argumentsOf(res.writeHead).some(([status]) => status === 404))
    assert.ok(argumentsOf(res.end).some(([body]) => body === '404 not found'))
  }
  assert.equal(statPath.mock.callCount(), 0)
})

test('serve-dist surfaces a post-stat stream fault as 500 with its cause', async () => {
  const fault = Object.assign(new Error('storage I/O failed'), { code: 'EIO' })
  const report = mock.fn()
  const server = await listen(
    createRehearsalRequestHandler({
      dist: '/dist',
      statPath: async () => ({ isFile: () => true }),
      openFile: () => {
        const stream = new PassThrough()
        queueMicrotask(() => stream.emit('error', fault))
        return stream
      },
      report,
    })
  )

  assert.equal((await requestText(server.port, '/assets/app.js')).status, 500)
  assert.ok(
    argumentsOf(report).some(
      ([message, error]) => message === 'serve-dist: static file failed' && error === fault
    )
  )
})
