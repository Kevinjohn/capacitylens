import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import test from 'node:test';
import { createLoopbackHttpProxyHandler } from './loopbackHttpProxy.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

function send(port, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: body ? { 'content-length': Buffer.byteLength(body) } : {},
      },
      (incoming) => {
        const chunks = [];
        incoming.on('data', (chunk) => chunks.push(chunk));
        incoming.on('end', () =>
          resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    outgoing.on('error', reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

test('loopback proxy pins the upstream and forwards only origin-form requests', async (t) => {
  const forwarded = [];
  let sentinelHits = 0;
  const upstream = createServer((incoming, outgoing) => {
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.on('end', () => {
      forwarded.push({
        method: incoming.method,
        url: incoming.url,
        body: Buffer.concat(chunks).toString(),
      });
      outgoing.end('upstream response');
    });
  });
  const sentinel = createServer((_incoming, outgoing) => {
    sentinelHits += 1;
    outgoing.end('sentinel reached');
  });
  let proxy;
  t.after(async () => {
    await Promise.all(
      [upstream, sentinel, proxy].filter(Boolean).map((server) => {
        if (!server.listening) return Promise.resolve();
        return new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        });
      }),
    );
  });
  const upstreamPort = await listen(upstream);
  const sentinelPort = await listen(sentinel);
  proxy = createServer(createLoopbackHttpProxyHandler(upstreamPort));
  const proxyPort = await listen(proxy);

  const normal = await send(proxyPort, '/api/probe?mode=smoke', {
    method: 'POST',
    body: 'payload',
  });
  assert.deepEqual(normal, { status: 200, body: 'upstream response' });
  assert.deepEqual(forwarded, [{ method: 'POST', url: '/api/probe?mode=smoke', body: 'payload' }]);

  for (const target of [
    `http://127.0.0.1:${sentinelPort}/private`,
    `//127.0.0.1:${sentinelPort}/private`,
  ]) {
    const rejected = await send(proxyPort, target);
    assert.equal(rejected.status, 400, `Expected rejection for ${target}`);
  }
  assert.equal(sentinelHits, 0);
  assert.equal(forwarded.length, 1);
});
