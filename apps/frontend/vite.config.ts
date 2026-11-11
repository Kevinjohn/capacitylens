import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import type { Plugin, ProxyOptions } from 'vite';
import { Agent } from 'node:http';
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
  const sockets = new Set<Socket>();
  const agent = new Agent({ keepAlive: false });
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
    configureServer(server) {
      server.httpServer?.once('close', () => agent.destroy());
      server.middlewares.use((request, response, next) => {
        if (request.url === '/__e2e/active-proxies') {
          response.statusCode = 200;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ activeRequests, openSockets: sockets.size }));
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
  const clientEnv = (name: 'VITE_CAPACITYLENS_API' | 'VITE_CAPACITYLENS_FEEDBACK_MAILTO') =>
    process.env[name] ?? fileEnv[name] ?? '';
  parseClientApiOrigin(clientEnv('VITE_CAPACITYLENS_API'));
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
