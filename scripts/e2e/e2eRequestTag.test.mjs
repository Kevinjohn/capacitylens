import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import {
  E2E_TAG_HEADER,
  E2E_TAG_PATH,
  installE2eRequestActivity,
} from '../../tooling/e2e_request_activity.ts'

/** A reset-enabled server whose `/api/held` and `/assets/held.js` handlers run until released. */
async function withTaggedServer(run, options) {
  const handled = []
  let releaseHeld
  let enteredHeld
  const held = new Promise((resolve) => (releaseHeld = resolve))
  const entered = new Promise((resolve) => (enteredHeld = resolve))
  const server = createServer()
  installE2eRequestActivity(
    server,
    async (request, response) => {
      handled.push(request.url)
      if (request.url === '/api/held' || request.url === '/assets/held.js') {
        enteredHeld()
        await held
      }
      response.end('handled')
    },
    options
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const send = (path, tag) =>
    fetch(`${origin}${path}`, { headers: tag ? { [E2E_TAG_HEADER]: tag } : {} })
  const advance = (tag) => fetch(`${origin}${E2E_TAG_PATH}?next=${tag}`, { method: 'POST' })
  try {
    await run({ send, advance, handled, entered, release: () => releaseHeld() })
  } finally {
    releaseHeld()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('before any tag is set, untagged and tagged API requests reach the application', async () => {
  await withTaggedServer(async ({ send, handled }) => {
    assert.equal((await send('/api/state')).status, 200)
    assert.equal((await send('/api/state', 'any-tag')).status, 200)
    assert.deepEqual(handled, ['/api/state', '/api/state'])
  })
})

test('an API request carrying a stale tag is refused before the application', async () => {
  await withTaggedServer(async ({ send, advance, handled }) => {
    assert.equal((await advance('test-1')).status, 200)
    assert.equal((await send('/api/state', 'test-1')).status, 200)
    assert.equal((await advance('test-2')).status, 200)
    for (const tag of ['test-1', undefined]) {
      const refused = await send('/api/state', tag)
      assert.equal(refused.status, 409)
      assert.match((await refused.json()).error, /stale e2e epoch: GET \/api\/state/)
    }
    assert.equal((await send('/assets/app.js')).status, 200, 'only /api/ requests carry a tag')
    assert.equal((await send('/api/state', 'test-2')).status, 200)
    assert.deepEqual(handled, ['/api/state', '/assets/app.js', '/api/state'])
  })
})

test('the control request answers only after running handlers finish, refusing the old tag meanwhile', async () => {
  await withTaggedServer(async ({ send, advance, handled, entered, release }) => {
    assert.equal((await advance('test-1')).status, 200)
    const running = send('/api/held', 'test-1')
    await entered
    let answered = false
    const settled = advance('test-2').then((response) => {
      answered = true
      return response
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(answered, false, 'the control request waits for the running handler')
    assert.equal((await send('/api/state', 'test-1')).status, 409, 'the new tag applies at once')
    release()
    assert.equal((await settled).status, 200)
    assert.equal((await running).status, 200)
    assert.deepEqual(handled, ['/api/held'])
  })
})

test('the control request fails with the running handlers listed when its wait expires', async () => {
  await withTaggedServer(
    async ({ send, advance, entered, release }) => {
      assert.equal((await advance('test-1')).status, 200)
      const running = send('/api/held', 'test-1')
      await entered
      const response = await advance('test-2')
      assert.equal(response.status, 503)
      assert.match(
        (await response.json()).error,
        /did not settle within 200 ms; 1 handlers still running: \[\{"method":"GET","path":"\/api\/held"/
      )
      release()
      assert.equal((await running).status, 200)
    },
    { settleTimeoutMs: 200 }
  )
})

test('an unfinished response outside /api/ does not hold the control request', async () => {
  await withTaggedServer(
    async ({ send, advance, entered, release }) => {
      assert.equal((await advance('test-1')).status, 200)
      const download = send('/assets/held.js')
      await entered
      assert.equal((await advance('test-2')).status, 200, 'a static file reaches no data')
      release()
      assert.equal((await download).status, 200)
    },
    { settleTimeoutMs: 200 }
  )
})
