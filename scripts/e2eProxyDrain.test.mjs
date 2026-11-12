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
import { assertE2eProxyDrained } from './e2eWorkerRuntime.mjs';
import {
  createResetControlToken,
  requestResetControl,
} from '../apps/backend/start/e2e_reset_control.ts';

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
      'CAPACITYLENS_E2E_RESET_TOKEN',
    ].map((name) => [name, process.env[name]]),
  );
  const temp = await mkdtemp(join(tmpdir(), 'capacitylens-e2e-proxy-drain-'));
  process.env.CAPACITYLENS_E2E_WORKER = '1';
  process.env.CAPACITYLENS_VITE_PORT = String(ports.web);
  process.env.CAPACITYLENS_DEV_API_PORT = String(ports.api);
  process.env.CAPACITYLENS_VITE_CACHE_DIR = join(temp, 'vite-cache');
  const controlToken = createResetControlToken();
  process.env.CAPACITYLENS_E2E_RESET_TOKEN = controlToken;

  let vite;
  let socket;
  let proxyUpstream;
  const proxiedPaths = [];
  try {
    proxyUpstream = http.createServer((request, response) => {
      proxiedPaths.push(request.url);
      response.end('upstream ok');
    });
    await new Promise((resolve, reject) => {
      proxyUpstream.once('error', reject);
      proxyUpstream.listen(ports.api, '127.0.0.1', resolve);
    });
    const { createServer } = await import(
      pathToFileURL(join(frontend, 'node_modules/vite/dist/node/index.js')).href
    );
    vite = await createServer({
      configFile: join(frontend, 'vite.config.ts'),
      root: frontend,
      server: { host: '127.0.0.1', strictPort: true },
      logLevel: 'silent',
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(
      address && typeof address === 'object',
      'expected Vite to listen on its reserved worker port',
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
    assert.deepEqual(await initialProbe.json(), {
      activeRequests: 0,
      openSockets: 1,
      pendingUpstreamRequests: 0,
    });
    await assert.rejects(
      assertE2eProxyDrained(origin),
      /0 active API requests, 1 open upstream sockets and 0 pending upstream requests/,
    );

    const socketClosed = new Promise((resolve) => socket.once('close', resolve));
    socket.destroy();
    await socketClosed;
    const drainedProbe = await fetch(`${origin}/__e2e/active-proxies`);
    assert.equal(drainedProbe.status, 200);
    assert.deepEqual(await drainedProbe.json(), {
      activeRequests: 0,
      openSockets: 0,
      pendingUpstreamRequests: 0,
    });
    await assertE2eProxyDrained(origin);

    const acceptedBufferedSocket = new Promise((resolve) => {
      vite.httpServer.once('connection', (accepted) => {
        accepted._handle.readStop();
        resolve(accepted);
      });
    });
    const bufferedClient = net.connect(address.port, '127.0.0.1');
    await acceptedBufferedSocket;
    const bufferedClosed = new Promise((resolve) => bufferedClient.once('close', resolve));
    bufferedClient.write(
      'GET /api/buffered-before-vite-pause HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
      () => bufferedClient.destroy(),
    );
    await bufferedClosed;
    const bufferedPause = await requestResetControl(controlToken, 'vite', 'pause');
    assert.equal(bufferedPause.paused, true);
    assert.equal(bufferedPause.listening, false);
    assert.equal(bufferedPause.openSockets, 0);
    assert.deepEqual(
      proxiedPaths,
      [],
      'the buffered request on the retired Vite socket never reaches the API upstream',
    );
    const bufferedResume = await requestResetControl(controlToken, 'vite', 'resume');
    assert.equal(bufferedResume.paused, false);
    assert.equal(bufferedResume.listening, true);
    assert.equal((await fetch(`${origin}/@vite/client`)).status, 200);
    assert.equal(await (await fetch(`${origin}/api/after-vite-resume`)).text(), 'upstream ok');
    assert.deepEqual(proxiedPaths, ['/api/after-vite-resume']);

    let releaseFirst;
    const firstObserved = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let heldResponse;
    const upstream = http.createServer((request, response) => {
      if (request.url === '/held') {
        heldResponse = response;
        releaseFirst();
      } else response.end('queued response');
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const agent = proxyOptions.agent;
    agent.maxSockets = 1;
    const outgoing = [];
    const startRequest = (path) => {
      const request = http.request(
        { host: '127.0.0.1', port: upstream.address().port, path, agent },
        (response) => response.resume(),
      );
      outgoing.push(request);
      const closed = new Promise((resolve, reject) => {
        request.once('close', resolve);
        request.once('error', reject);
      });
      // Cleanup may destroy a request before the success path awaits its close.
      void closed.catch(() => {});
      request.end();
      return { request, closed };
    };
    try {
      const first = startRequest('/held');
      await firstObserved;
      const queued = startRequest('/queued');
      assert.equal(
        queued.request.socket,
        null,
        'the second outgoing request has no assigned socket',
      );
      assert.deepEqual(await (await fetch(`${origin}/__e2e/active-proxies`)).json(), {
        activeRequests: 0,
        openSockets: 0,
        pendingUpstreamRequests: 2,
      });
      await assert.rejects(assertE2eProxyDrained(origin), /2 pending upstream requests/);
      heldResponse.end('first response');
      await Promise.all([first.closed, queued.closed]);
      await assertE2eProxyDrained(origin);

      assert.equal(typeof WebSocket, 'function', 'Node provides the WebSocket client for HMR');
      const hmrUrl = `ws://127.0.0.1:${address.port}/?token=${vite.config.webSocketToken}`;
      const websocket = new WebSocket(hmrUrl, 'vite-hmr');
      const websocketOpen = new Promise((resolve, reject) => {
        websocket.addEventListener('open', resolve, { once: true });
        websocket.addEventListener('error', reject, { once: true });
      });
      const websocketClosed = new Promise((resolve) =>
        websocket.addEventListener('close', resolve, { once: true }),
      );
      await websocketOpen;
      const paused = await requestResetControl(controlToken, 'vite', 'pause');
      assert.equal(paused.paused, true);
      assert.equal(paused.listening, false);
      assert.equal(paused.openSockets, 0);
      await websocketClosed;
      const resumed = await requestResetControl(controlToken, 'vite', 'resume');
      assert.equal(resumed.paused, false);
      assert.equal(resumed.listening, true);
      const afterResume = await fetch(`${origin}/__e2e/active-proxies`);
      assert.equal(afterResume.status, 200);
      assert.deepEqual(await afterResume.json(), {
        activeRequests: 0,
        openSockets: 0,
        pendingUpstreamRequests: 0,
      });
      const reconnectedWebsocket = new WebSocket(hmrUrl, 'vite-hmr');
      await new Promise((resolve, reject) => {
        reconnectedWebsocket.addEventListener('open', resolve, { once: true });
        reconnectedWebsocket.addEventListener('error', reject, { once: true });
      });
      const reconnectedClosed = new Promise((resolve) =>
        reconnectedWebsocket.addEventListener('close', resolve, { once: true }),
      );
      reconnectedWebsocket.close();
      await reconnectedClosed;
    } finally {
      outgoing.forEach((request) => request.destroy());
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
    }
  } finally {
    socket?.destroy();
    if (vite) await vite.close();
    if (proxyUpstream) {
      proxyUpstream.closeAllConnections();
      await new Promise((resolve) => proxyUpstream.close(resolve));
    }
    await rm(temp, { recursive: true, force: true });
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
