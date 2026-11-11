import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Start, probe and stop a built backend on a private loopback port. Shared by the packaged smoke
// and the planning benchmark.

export const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

export function message(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  return address.port;
}

/** Use native password authentication and database sessions in a private loopback fixture. */
export function buildSmokeEnvironment(inherited, { backupDir, databasePath, port, corsOrigin }) {
  const environment = { ...inherited };
  delete environment.NODE_PATH;
  delete environment.NODE_OPTIONS;
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith('CAPACITYLENS_') ||
      key.startsWith('BETTER_AUTH_') ||
      key.startsWith('VITE_CAPACITYLENS_') ||
      key.startsWith('SMALLSASS_ACCOUNT_')
    )
      delete environment[key];
  }
  return Object.assign(environment, {
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'info',
    APP_KEY: 'capacitylens-packaged-smoke-key-0123456789abcdef',
    // Production refuses plain-HTTP public origins; links name HTTPS while the smoke talks to loopback.
    APP_URL: `https://127.0.0.1:${port}`,
    SESSION_DRIVER: 'database',
    CAPACITYLENS_SECRET: 'capacitylens-packaged-secret-0123456789abcdef',
    CAPACITYLENS_AUDIT: 'on',
    CAPACITYLENS_ALLOW_OPEN_SIGNUP: 'true',
    CAPACITYLENS_DB: databasePath,
    CAPACITYLENS_BACKUP_DIR: backupDir,
    CAPACITYLENS_PUBLIC_URL: `https://127.0.0.1:${port}`,
    ...(corsOrigin ? { CAPACITYLENS_CORS_ORIGIN: corsOrigin } : {}),
  });
}

/** Return the exit status, separate streams and combined diagnostics from a built backend command. */
export function runAce(backend, environment, args, timeout = 30_000) {
  const result = spawnSync(process.execPath, ['ace.js', ...args], {
    cwd: backend,
    env: environment,
    encoding: 'utf8',
    timeout,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

export async function waitFor(description, timeoutMs, check, child) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.outcome)
      throw new Error(`Packaged server exited early: ${JSON.stringify(child.outcome)}`);
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${message(lastError)}` : ''}`,
  );
}

export async function fetchOk(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  assert.ok(response.ok, `${options.method ?? 'GET'} ${url} returned ${response.status}: ${body}`);
  return { response, body };
}

/** Read a JSON response once while retaining its body in assertion failures. */
export async function expectJsonStatus(response, expectedStatus, description) {
  const body = await response.text();
  assert.equal(response.status, expectedStatus, `${description}: ${body}`);
  return JSON.parse(body);
}

export function startServer(backend, environment, appendLog) {
  const processHandle = spawn(process.execPath, ['bin/server.js'], {
    cwd: backend,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processHandle.stdout.setEncoding('utf8').on('data', appendLog);
  processHandle.stderr.setEncoding('utf8').on('data', appendLog);
  const child = { processHandle, outcome: null, exit: null };
  child.exit = new Promise((resolveExit) => {
    processHandle.once('error', (error) => {
      child.outcome = { error: message(error) };
      resolveExit(child.outcome);
    });
    processHandle.once('exit', (code, signal) => {
      child.outcome = { code, signal };
      resolveExit(child.outcome);
    });
  });
  return child;
}

export async function stopServer(child) {
  if (child.outcome) return child.outcome;
  child.processHandle.kill('SIGTERM');
  const result = await Promise.race([child.exit, delay(SHUTDOWN_TIMEOUT_MS, null)]);
  if (result) return result;
  child.processHandle.kill('SIGKILL');
  await child.exit;
  throw new Error('The packaged server did not stop within 10 seconds of SIGTERM.');
}

export async function waitUntilReady(baseUrl, child) {
  return waitFor(
    'readiness',
    STARTUP_TIMEOUT_MS,
    async () => {
      const response = await fetch(`${baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(1_000),
      });
      return response.ok;
    },
    child,
  );
}
