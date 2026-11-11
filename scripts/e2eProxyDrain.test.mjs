import { E2E_SCRIPT_TEST_SLOTS } from './e2eTestSlots.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { resolveLane, workerPorts } from './ports.mjs';
import { assertE2eProxyDrained, waitForE2eWorkerDrain } from './e2eWorkerRuntime.mjs';

const frontend = join(process.cwd(), 'apps/frontend');
const lane = resolveLane();
const slot = E2E_SCRIPT_TEST_SLOTS.proxy;
const ports = workerPorts(lane, slot);

test('the Vite drain probe refuses open upstream sockets even when no proxy request is active', async () => {
  const previousEnvironment = new Map(
    [
      'CAPACITYLENS_E2E_WORKER',
      'CAPACITYLENS_VITE_PORT',
      'CAPACITYLENS_DEV_API_PORT',
      'CAPACITYLENS_VITE_CACHE_DIR',
    ].map((name) => [name, process.env[name]]),
  );
  const temp = await mkdtemp(join(tmpdir(), 'capacitylens-e2e-proxy-drain-'));
  process.env.CAPACITYLENS_E2E_WORKER = '1';
  process.env.CAPACITYLENS_VITE_PORT = String(ports.web);
  process.env.CAPACITYLENS_DEV_API_PORT = String(ports.api);
  process.env.CAPACITYLENS_VITE_CACHE_DIR = join(temp, 'vite-cache');

  let vite;
  let socket;
  try {
    const { createServer } = await import(
      pathToFileURL(join(frontend, 'node_modules/vite/dist/node/index.js')).href
    );
    vite = await createServer({
      configFile: join(frontend, 'vite.config.ts'),
      root: frontend,
      server: { host: '127.0.0.1', port: 0, strictPort: false },
      logLevel: 'silent',
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(
      address && typeof address === 'object',
      'expected Vite to listen on an ephemeral port',
    );
    const origin = `http://127.0.0.1:${address.port}`;

    const proxyOptions = vite.config.server.proxy?.['/api'];
    assert.ok(
      proxyOptions && !Array.isArray(proxyOptions),
      'expected the worker API proxy configuration',
    );
    assert.equal(typeof proxyOptions.configure, 'function');
    const proxy = new EventEmitter();
    proxyOptions.configure(proxy);

    socket = new net.Socket();
    proxy.emit('proxyReq', { socket });
    const initialProbe = await fetch(`${origin}/__e2e/active-proxies`);
    assert.equal(initialProbe.status, 200);
    assert.deepEqual(await initialProbe.json(), { activeRequests: 0, openSockets: 1 });
    await assert.rejects(
      assertE2eProxyDrained(origin),
      /0 active API requests and 1 open upstream sockets/,
    );

    const socketClosed = new Promise((resolve) => socket.once('close', resolve));
    socket.destroy();
    await socketClosed;
    const drainedProbe = await fetch(`${origin}/__e2e/active-proxies`);
    assert.equal(drainedProbe.status, 200);
    assert.deepEqual(await drainedProbe.json(), { activeRequests: 0, openSockets: 0 });
    await assertE2eProxyDrained(origin);
  } finally {
    socket?.destroy();
    if (vite) await vite.close();
    await rm(temp, { recursive: true, force: true });
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('worker drain waits for staged activity, bounds busy responses and propagates malformed probes', async () => {
  let requests = 1;
  let malformed = false;
  let observed;
  const busyObserved = new Promise((done) => {
    observed = done;
  });
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify(
        malformed
          ? {}
          : request.url.startsWith('/__e2e')
            ? { activeRequests: 0, openSockets: 0 }
            : { activeRequests: requests },
      ),
    );
    if (!request.url.startsWith('/__e2e') && requests > 0) observed();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const target = { api: origin, web: origin };
  try {
    let settled = false;
    const draining = waitForE2eWorkerDrain(target).then(() => {
      settled = true;
    });
    await busyObserved;
    assert.equal(settled, false, 'busy handler cannot be mistaken for a completed reset boundary');
    requests = 0;
    await draining;
    assert.equal(settled, true);
    requests = 1;
    await assert.rejects(waitForE2eWorkerDrain(target, 0), /API has 1 active requests/);
    malformed = true;
    await assert.rejects(waitForE2eWorkerDrain(target), /invalid active request count/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
