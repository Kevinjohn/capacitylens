import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { expect, request as playwrightRequest } from '@playwright/test';
import { requireStateRows, serverState } from '../e2e/serverTestState.ts';

const canonicalState = { clients: [{ id: 'c-example', name: 'Example Client' }] };

async function withApi(handler, run) {
  const sockets = new Set();
  const server = createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const context = await playwrightRequest.newContext({ timeout: 3_000 });
  const target = {
    lane: 0,
    slot: 0,
    api: `http://127.0.0.1:${address.port}`,
    web: 'http://127.0.0.1:1',
    databasePath: '/tmp/server-state-transport-test.db',
    templatePath: '/tmp/server-state-transport-test.db.template',
  };

  try {
    await run({ context, target, server });
  } finally {
    await context.dispose();
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
}

test('serverState retries one reset and returns the actual canonical response', async () => {
  let attempts = 0;
  await withApi(
    (request, response) => {
      attempts += 1;
      if (attempts === 1) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(canonicalState));
    },
    async ({ context, target }) => {
      assert.deepEqual(await serverState(context, target), canonicalState);
      assert.equal(attempts, 2);
    },
  );
});

for (const status of [500, 403]) {
  test(`serverState does not retry an initial HTTP ${status}`, async () => {
    let attempts = 0;
    await withApi(
      (_request, response) => {
        attempts += 1;
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'Expected test failure' }));
      },
      async ({ context, target }) => {
        await assert.rejects(serverState(context, target), /Received: false/);
        assert.equal(attempts, 1);
      },
    );
  });

  test(`serverState fails when a reset is followed by HTTP ${status}`, async () => {
    let attempts = 0;
    await withApi(
      (request, response) => {
        attempts += 1;
        if (attempts === 1) {
          request.socket.destroy();
          return;
        }
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'Expected test failure' }));
      },
      async ({ context, target }) => {
        await assert.rejects(serverState(context, target), /Received: false/);
        assert.equal(attempts, 2);
      },
    );
  });
}

test('serverState fails after two consecutive resets', async () => {
  let attempts = 0;
  await withApi(
    (request) => {
      attempts += 1;
      request.socket.destroy();
    },
    async ({ context, target }) => {
      await assert.rejects(serverState(context, target), /Failed after 2 attempt/);
      assert.equal(attempts, 2);
    },
  );
});

test('the resilience state poll remains bounded when each canonical read persistently resets', async () => {
  let attempts = 0;
  let pollCalls = 0;
  await withApi(
    (request) => {
      attempts += 1;
      request.socket.destroy();
    },
    async ({ context, target }) => {
      await assert.rejects(
        expect
          .poll(
            async () => {
              pollCalls += 1;
              return requireStateRows(await serverState(context, target), 'clients').length;
            },
            { timeout: 800, intervals: [10, 20, 30] },
          )
          .toBe(1),
        /Failed after 2 attempt/,
      );
      assert.equal(pollCalls, 1);
      assert.equal(attempts, pollCalls * 2);
    },
  );
});

test('serverState does not retry when the API listener disappears after a reset', async () => {
  let requests = 0;
  let connections = 0;
  await withApi(
    (request) => {
      requests += 1;
      // Close inside the request: from Node 26, closing on `connection` also drops the idle socket.
      request.socket.server.close();
      request.socket.destroy();
    },
    async ({ context, target, server }) => {
      server.on('connection', () => {
        connections += 1;
      });
      await assert.rejects(serverState(context, target), /Failed after 2 attempt.*ECONNREFUSED/s);
      assert.equal(requests, 1);
      assert.equal(connections, 1);
    },
  );
});

test('serverState propagates an initial non-reset connection failure without retrying', async () => {
  let requests = 0;
  await withApi(
    () => {
      requests += 1;
    },
    async ({ context, target, server }) => {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await assert.rejects(serverState(context, target), (error) => {
        assert.match(error.message, /ECONNREFUSED/);
        assert.doesNotMatch(error.message, /Failed after/);
        return true;
      });
      assert.equal(requests, 0);
    },
  );
});
