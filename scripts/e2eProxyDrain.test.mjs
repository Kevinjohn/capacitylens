import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { workerPorts } from './ports.mjs';
import { assertE2eProxyDrained } from './e2eWorkerRuntime.mjs';

const frontend = join(process.cwd(), 'apps/frontend');
const lane = 9;
const slot = 48;
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
