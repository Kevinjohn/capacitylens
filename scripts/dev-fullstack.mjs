// Start the API and web server together because server-backed app mode needs the Vite proxy's API.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parsePort } from './parsePort.mjs';
import { spawnPnpm } from './pnpmSpawn.mjs';
import { ports, resolveLane } from './ports.mjs';
import { createDisposableDemoStorage } from './disposableDemoStorage.mjs';
import {
  isProcessTreeRunning,
  portInUse,
  requireNode24,
  terminateProcessTrees,
} from './devProcesses.mjs';

export async function runDevelopmentStack({ demo = false } = {}) {
  if (demo && process.env.NODE_ENV === 'production')
    throw new Error('Disposable demo is forbidden in production');
  // Report the Node requirement before the API child fails to load `node:sqlite`.
  requireNode24(
    (version) =>
      `dev: full-stack dev needs Node 24+ — found ${version}. The API uses Node's ` +
      `built-in node:sqlite (see .nvmrc). Fix: \`nvm use\`, or install Node 24+ from ` +
      `https://nodejs.org.`,
  );

  // Use the configured API port, defaulting to this lane's port, for the server and Vite proxy.
  const lanePorts = ports();
  const API_PORT = parsePort(
    process.env.CAPACITYLENS_DEV_API_PORT,
    lanePorts.dbApi,
    'CAPACITYLENS_DEV_API_PORT',
  );
  const WEB_PORT = lanePorts.web;

  // Check both ports before starting either child so a collision cannot leave a half-started stack.
  if (await portInUse(API_PORT)) {
    console.error(
      `dev: port ${API_PORT} is already in use — the API can't start. Stop whatever holds it ` +
        `(another \`pnpm run dev\`, a stray CapacityLens backend), or set CAPACITYLENS_DEV_API_PORT ` +
        `to a free port. Not starting the web server to avoid a half-up stack.`,
    );
    process.exit(1);
  }

  if (await portInUse(WEB_PORT)) {
    console.error(
      `dev: port ${WEB_PORT} is already in use — the Vite web server can't start (strictPort). Stop ` +
        `whatever holds it (for example another \`pnpm run dev\` or \`pnpm run dev:demo\`). ` +
        `Not starting the API server to avoid a half-up stack.`,
    );
    process.exit(1);
  }

  const children = [];
  let demoStorage;
  let shuttingDown = false;

  // Attempt bounded cleanup of both detached child process trees.
  async function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    let exitCode = code;
    try {
      await terminateProcessTrees(children);
      if (demoStorage && !(await demoStorage.cleanup(children))) {
        console.error(
          `dev: demo storage retained because process-tree exit could not be verified: ${demoStorage.directory}`,
        );
        exitCode = 1;
      }
    } catch (error) {
      console.error(
        `dev: cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      exitCode = 1;
    } finally {
      process.exit(exitCode);
    }
  }

  function start(label, args, env, oneShot = false) {
    const child = spawnPnpm(args, {
      // Ignore stdin (inherit stdout/stderr): with detached:true the child is outside the terminal's
      // foreground group, so handing it the TTY stdin risks SIGTTIN and trips Vite's stdin-EOF→SIGTERM
      // shortcut handler. Neither tsx-watch nor Vite needs interactive stdin under this launcher.
      stdio: ['ignore', 'inherit', 'inherit'],
      // Give each child its own process group so shutdown can stop both process trees.
      detached: true,
      env: { ...process.env, ...env },
    });
    children.push(child);
    // Either child exiting tears the whole stack down. A dead API or a dead web server both mean
    // dev is broken, and we attempt bounded cleanup of both child trees.
    child.on('exit', (code, signal) => {
      if (shuttingDown || (oneShot && code === 0)) return;
      console.error(
        `dev: ${label} exited (${signal ? `signal ${signal}` : `code ${code}`}); shutting down.`,
      );
      void shutdown(code ?? 1);
    });
    child.on('error', (err) => {
      if (shuttingDown) return;
      console.error(`dev: failed to launch ${label}: ${err.message}`);
      void shutdown(1);
    });
    return child;
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => void shutdown(0));
  }

  try {
    const apiEnvironment = { PORT: String(API_PORT) };
    if (demo) {
      demoStorage = await createDisposableDemoStorage(resolveLane());
      Object.assign(apiEnvironment, {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        LOG_LEVEL: 'info',
        SESSION_DRIVER: 'database',
        CAPACITYLENS_DB: demoStorage.databasePath,
        CAPACITYLENS_CREATE_ADMIN_ADMIN: '1',
        CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: 'capacitylens-demo-2026',
        CAPACITYLENS_SECRET: 'capacitylens-disposable-demo-secret-2026',
        APP_KEY: 'capacitylens-disposable-demo-key-2026',
        APP_URL: `http://localhost:${API_PORT}`,
        CAPACITYLENS_PUBLIC_URL: `http://localhost:${API_PORT}`,
        CAPACITYLENS_CORS_ORIGIN: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
        CAPACITYLENS_BACKUP_DIR: '',
        CAPACITYLENS_MAIL_HOST: '',
        CAPACITYLENS_MAIL_PORT: '',
        CAPACITYLENS_MAIL_USER: '',
        CAPACITYLENS_MAIL_PASSWORD: '',
        CAPACITYLENS_MAIL_FROM: '',
      });
      const acePreparations = [
        ['migration:run', '--force', '--no-schema-generate'],
        ['capacitylens:demo:prepare'],
        ['capacitylens:demo:seed'],
      ].map((args) => ['--dir', 'apps/backend', 'exec', 'node', 'ace.js', ...args]);
      // A fresh frozen install has no compiled shared-package exports yet.
      for (const args of [
        ['--dir', 'packages/shared', 'exec', 'tsc', '--build', 'tsconfig.build.json', '--force'],
        ...acePreparations,
      ]) {
        const child = start('demo preparation', args, apiEnvironment, true);
        await new Promise((done, reject) => {
          child.once('exit', (code) =>
            code === 0 ? done() : reject(new Error('Demo preparation failed')),
          );
          child.once('error', reject);
        });
        if (isProcessTreeRunning(child))
          throw new Error('Demo preparation left running descendants');
        children.splice(children.indexOf(child), 1);
      }
    }
    start('api', ['--filter', '@capacitylens/backend', 'run', 'dev'], apiEnvironment);
    if (demo) await waitUntilReady(`http://127.0.0.1:${API_PORT}/health/ready`);
    const webEnvironment = { CAPACITYLENS_DEV_API_PORT: String(API_PORT) };
    if (demo)
      Object.assign(webEnvironment, {
        VITE_CAPACITYLENS_API: '',
        CAPACITYLENS_VITE_SERVICE: 'web',
        CAPACITYLENS_VITE_PORT: String(WEB_PORT),
        CAPACITYLENS_E2E_WORKER: '0',
      });
    start('web', ['run', 'dev:web'], webEnvironment);
    if (demo) {
      await waitUntilReady(`http://127.0.0.1:${WEB_PORT}/health/ready`);
      console.info(`Demo ready: http://localhost:${WEB_PORT}`);
      console.info(`Disposable database: ${demoStorage.databasePath}`);
      console.info('Sign in: admin@admin.admin / capacitylens-demo-2026');
      console.info('Data persists on refresh and resets when dev:demo restarts.');
    }
  } catch (error) {
    console.error(`dev: startup failed: ${error instanceof Error ? error.message : String(error)}`);
    await shutdown(1);
  }

  async function waitUntilReady(url) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) return;
      } catch (error) {
        if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    console.error(`dev: readiness timed out for ${url}`);
    await shutdown(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runDevelopmentStack();
