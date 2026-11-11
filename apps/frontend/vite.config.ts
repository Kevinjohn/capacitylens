import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import type { Plugin, ProxyOptions } from 'vite';
import { Agent } from 'node:http';
import type { ClientRequest, RequestOptions } from 'node:http';
import type { Socket } from 'node:net';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePort } from '../../scripts/parsePort.mjs';
import { ports, testShare } from '../../scripts/ports.mjs';
import { parseClientApiOrigin } from '../../scripts/render-client-nginx.mjs';
import { STATIC_SPA_ROUTES } from '../../scripts/staticSpaRoutes.mjs';
import { ENTRY_RAW_LIMIT_KB } from '../../scripts/bundleBudget.mjs';
import { isAccountEmail } from '../../packages/shared/src/account/validation.ts';
import {
  createResetControlServer,
  createRetirableListener,
} from '../../apps/backend/start/e2e_reset_control.ts';

// Lane-derived ports keep concurrent worktrees on disjoint service endpoints.
const lanePorts = ports();
const devApiPort = parsePort(
  process.env.CAPACITYLENS_DEV_API_PORT,
  lanePorts.dbApi,
  'CAPACITYLENS_DEV_API_PORT',
);
// One Vite config serves several dev servers on different ports (the core app, and the db/auth
// flavours Playwright boots). The service name selects which lane port this invocation binds,
// so no script has to pass a literal `--port`.
const viteService = process.env.CAPACITYLENS_VITE_SERVICE ?? 'web';
if (!Object.hasOwn(lanePorts, viteService)) {
  throw new Error(
    `CAPACITYLENS_VITE_SERVICE must name a lane port; received ${JSON.stringify(viteService)}.`,
  );
}
const servicePort = lanePorts[viteService as keyof typeof lanePorts];
const e2eWorker = process.env.CAPACITYLENS_E2E_WORKER === '1';
const e2eResetToken = process.env.CAPACITYLENS_E2E_RESET_TOKEN;
/**
 * Emit real directory index documents for fixed client routes. The packaged nginx image still
 * provides the normal SPA fallback, while these aliases also survive a static outer proxy that
 * serves only paths which physically exist (the production failure mode this guards). Keep the
 * filesystem work in `writeBundle`: Rollup also runs `closeBundle` while unwinding failed builds,
 * before Vite has emitted `index.html`.
 */
export function staticSpaRouteDocuments(): Plugin {
  let outputDirectory = '';
  return {
    name: 'capacitylens-static-spa-route-documents',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      const shell = resolve(outputDirectory, 'index.html');
      for (const route of STATIC_SPA_ROUTES) {
        const directory = resolve(outputDirectory, route);
        await mkdir(directory, { recursive: true });
        await copyFile(shell, resolve(directory, 'index.html'));
      }
    },
  };
}

/** Track pending proxy requests and their actual upstream sockets before a worker resets SQLite. */
function createE2eProxyDrainProbe() {
  let activeRequests = 0;
  let pendingUpstreamRequests = 0;
  const sockets = new Set<Socket>();
  const agent = new Agent({ keepAlive: false });
  let listenerControl: ReturnType<typeof createRetirableListener> | undefined;
  let controlServer: ReturnType<typeof createResetControlServer> | undefined;
  // The configured proxies have no async bypass hook, so proxy.web reaches Agent admission
  // synchronously before pause control can interleave; this also covers requests queued for sockets.
  const dispatchingAgent = agent as Agent & {
    addRequest(request: ClientRequest, options: RequestOptions): void;
  };
  const addRequest = dispatchingAgent.addRequest.bind(agent);
  dispatchingAgent.addRequest = (request, options) => {
    pendingUpstreamRequests += 1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      pendingUpstreamRequests -= 1;
    };
    request.once('close', finish);
    try {
      addRequest(request, options);
    } catch (error) {
      request.off('close', finish);
      finish();
      throw error;
    }
  };
  const configure: NonNullable<ProxyOptions['configure']> = (proxy) => {
    proxy.on('proxyReq', (request) => {
      const observe = (socket: Socket) => {
        if (socket.destroyed || sockets.has(socket)) return;
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
      };
      if (request.socket) observe(request.socket);
      else request.once('socket', observe);
    });
  };
  const plugin: Plugin = {
    name: 'capacitylens-e2e-proxy-drain-probe',
    async configureServer(server) {
      const httpServer = server.httpServer;
      if (e2eResetToken && httpServer) {
        listenerControl = createRetirableListener(httpServer, {
          role: 'vite',
          listen: async () => {
            await server.listen();
          },
          async waitForQuiescence(timeoutMs) {
            const deadline = Date.now() + timeoutMs;
            while (activeRequests || pendingUpstreamRequests || sockets.size) {
              if (Date.now() >= deadline)
                throw new Error(
                  `Vite pause timed out with ${activeRequests} active API requests, ${pendingUpstreamRequests} pending upstream requests and ${sockets.size} open upstream sockets.`,
                );
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            return {
              activeRequests,
              pendingUpstreamRequests,
              openUpstreamSockets: sockets.size,
            };
          },
          status: () => ({
            activeRequests,
            pendingUpstreamRequests,
            openUpstreamSockets: sockets.size,
          }),
        });
        controlServer = createResetControlServer(e2eResetToken, 'vite', {
          status: listenerControl.status,
          pause(timeoutMs) {
            agent.destroy();
            return listenerControl!.pause(timeoutMs);
          },
          resume: listenerControl.resume,
        });
        await controlServer.ready;
      }

      server.middlewares.use((request, _response, next) => {
        if (listenerControl?.shouldReject(request.socket)) {
          request.socket.destroy();
          return;
        }
        next();
      });
      server.httpServer?.once('close', () => agent.destroy());
      server.middlewares.use((request, response, next) => {
        if (request.url === '/__e2e/active-proxies') {
          response.statusCode = 200;
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({ activeRequests, openSockets: sockets.size, pendingUpstreamRequests }),
          );
          return;
        }
        if (!request.url?.startsWith('/api/') && !request.url?.startsWith('/health')) return next();
        activeRequests += 1;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          activeRequests -= 1;
        };
        response.once('finish', finish);
        response.once('close', finish);
        next();
      });
    },
    async closeServer() {
      await controlServer?.close();
    },
  };
  return { plugin, proxyOptions: { agent, configure } };
}

/** Configures application builds and lane-local development, refusing invalid client deployment settings. */
export default defineConfig(({ mode, command }) => {
  const workerServe = command === 'serve' && e2eWorker;
  const drainProbe = workerServe ? createE2eProxyDrainProbe() : null;
  const vitePort = workerServe
    ? parsePort(process.env.CAPACITYLENS_VITE_PORT, servicePort, 'CAPACITYLENS_VITE_PORT')
    : servicePort;
  // Stryker loads this config from the repository root, so resolve frontend paths from the config file.
  const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
  const fileEnv = loadEnv(mode, frontendRoot, 'VITE_CAPACITYLENS_');
  const clientEnv = (
    name: 'VITE_CAPACITYLENS_API' | 'VITE_CAPACITYLENS_DEMO' | 'VITE_CAPACITYLENS_FEEDBACK_MAILTO',
  ) => process.env[name] ?? fileEnv[name] ?? '';
  parseClientApiOrigin(clientEnv('VITE_CAPACITYLENS_API'), clientEnv('VITE_CAPACITYLENS_DEMO'));
  const feedbackAddress = clientEnv('VITE_CAPACITYLENS_FEEDBACK_MAILTO').trim();
  if (feedbackAddress !== '' && !isAccountEmail(feedbackAddress)) {
    throw new Error('VITE_CAPACITYLENS_FEEDBACK_MAILTO must be one valid email address.');
  }

  return {
    root: frontendRoot,
    ...(workerServe && process.env.CAPACITYLENS_VITE_CACHE_DIR
      ? { cacheDir: process.env.CAPACITYLENS_VITE_CACHE_DIR }
      : {}),
    build: {
      outDir: '../../dist',
      emptyOutDir: true,
      // The post-build checker also enforces the gzip limit. Sharing its raw boundary keeps Vite's
      // generic chunk warning actionable instead of warning below the project's deliberate budget.
      chunkSizeWarningLimit: ENTRY_RAW_LIMIT_KB,
    },
    plugins: [
      react(),
      tailwindcss(),
      staticSpaRouteDocuments(),
      // Paraglide generates messages from committed sources during dev and builds. Package scripts
      // precompile them so direct type-check and Vitest commands can resolve the output. The
      // account-scoped locale stays client-only in a global variable; baseLocale keeps English as
      // the fallback without a page reload or server round-trip.
      ...(!workerServe
        ? [
            paraglideVitePlugin({
              project: './project.inlang',
              outdir: './src/paraglide',
              outputStructure: 'locale-modules',
              strategy: ['globalVariable', 'baseLocale'],
            }),
          ]
        : []),
      ...(drainProbe ? [drainProbe.plugin] : []),
    ],
    resolve: {
      alias: {
        '@capacitylens/shared': fileURLToPath(
          new URL('../../packages/shared/src', import.meta.url),
        ),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // Bind IPv4 loopback so clients using 127.0.0.1 can reach the server regardless of localhost address ordering.
    // Refuse occupied ports so the launcher and browser retain the same endpoint.
    server: {
      host: '127.0.0.1',
      port: vitePort,
      strictPort: true,
      // The dev proxy and full-stack launcher share the configured lane API port so browser requests stay same-origin.
      proxy: {
        '/api': {
          // Keep this `CAPACITYLENS_DEV_API_PORT ?? lane dbApi` default identical to
          // scripts/dev-fullstack.mjs's API_PORT so the launcher and this proxy stay in lockstep.
          target: `http://localhost:${devApiPort}`,
          changeOrigin: true,
          ...(drainProbe?.proxyOptions ?? {}),
        },
        '/health': {
          target: `http://localhost:${devApiPort}`,
          changeOrigin: true,
          ...(drainProbe?.proxyOptions ?? {}),
        },
      },
    },
    // `vite preview` and scripts/serve-dist.mjs both default to 4173, so this needs a lane too.
    preview: {
      host: '127.0.0.1',
      port: lanePorts.preview,
      strictPort: true,
    },
    test: {
      // Without a reserved share, use the same half-core ceiling as a solo lane claim.
      maxWorkers: testShare(),
      environment: 'jsdom',
      env: { TZ: 'UTC' },
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}', '../../packages/shared/**/*.{test,spec}.ts'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'html', 'lcov'],
        include: ['src/**/*.{ts,tsx}', '../../packages/shared/src/**/*.ts'],
        exclude: [
          '**/*.test.{ts,tsx}',
          'src/test/**',
          'src/main.tsx',
          'src/router.tsx',
          'src/vite-env.d.ts',
          // Paraglide generates this message runtime from committed sources, so coverage excludes it.
          'src/paraglide/**',
        ],
      },
    },
  };
});
