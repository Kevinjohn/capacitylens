import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerPorts, resolveLane } from './ports.mjs';
import { portInUse } from './devProcesses.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const backend = join(root, 'apps/backend');
const leaseRoot = join(tmpdir(), 'capacitylens-e2e-workers');
const readinessTimeoutMs = 120_000;
const cachePath = (lane, slot) => join(root, 'node_modules', `.vite-e2e-l${lane}-w${slot}`);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function leasePaths(lane, slot, ownerName) {
  const lock = join(leaseRoot, `l${lane}-w${slot}.lock`);
  return { lock, owner: ownerName ? join(lock, ownerName) : undefined };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function processGroupExists(group) {
  if (!Number.isInteger(group) || group <= 0) return false;
  if (process.platform === 'win32') return processExists(group);
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

async function readOwner(ownerPath) {
  try {
    const contents = await readFile(ownerPath, 'utf8');
    const owner = JSON.parse(contents);
    if (
      !Number.isInteger(owner.pid) ||
      owner.pid <= 0 ||
      !Array.isArray(owner.groups) ||
      owner.groups.some((group) => !Number.isInteger(group) || group <= 0)
    )
      throw new Error(`Worker lease owner record is invalid: ${ownerPath}`);
    return owner;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError)
      throw new Error(`Worker lease owner record is incomplete: ${ownerPath}`, { cause: error });
    throw error;
  }
}

async function waitForRecordedGroups(groups) {
  const deadline = Date.now() + 5_000;
  while (groups.some(processGroupExists) && Date.now() < deadline) await sleep(25);
  const survivors = groups.filter(processGroupExists);
  if (survivors.length)
    throw new Error(
      `Stale E2E worker process groups remain alive; preserving the lease and worker files: ${survivors.join(', ')}.`,
    );
}

/** Release only the unique owner record held by this lease. */
async function releaseLease(paths) {
  if (paths.owner) await rm(paths.owner, { force: true });
  try {
    await rmdir(paths.lock);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  }
}

/** Claim a complete owner directory, recovering only demonstrably dead owners. */
async function acquireLease(lane, slot) {
  await mkdir(leaseRoot, { recursive: true });
  const pendingPrefix = `l${lane}-w${slot}.lock.pending-`;
  for (const entry of await readdir(leaseRoot, { withFileTypes: true })) {
    const pending = entry.name.startsWith(pendingPrefix)
      ? /^(\d+)-[a-f0-9-]+$/.exec(entry.name.slice(pendingPrefix.length))
      : null;
    if (entry.isDirectory() && pending && !processExists(Number(pending[1])))
      await rm(join(leaseRoot, entry.name), { recursive: true, force: true });
  }
  const ownerName = `owner-${process.pid}-${randomUUID()}.json`;
  const paths = leasePaths(lane, slot, ownerName);
  const candidate = `${paths.lock}.pending-${process.pid}-${randomUUID()}`;
  let recovered = false;
  try {
    await mkdir(candidate, { mode: 0o700 });
    writeFileSync(join(candidate, ownerName), JSON.stringify({ pid: process.pid, groups: [] }), {
      mode: 0o600,
    });
    for (;;) {
      try {
        // Publishing a populated directory makes the complete owner visible in one operation.
        // It cannot replace a live lease's populated directory.
        renameSync(candidate, paths.lock);
        return { paths, recovered };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EISDIR', 'ENOTDIR', 'EPERM'].includes(error.code))
          throw error;
        let owners;
        let entries;
        try {
          entries = await readdir(paths.lock);
          owners = entries.filter((name) => /^owner-\d+-[a-f0-9-]+\.json$/.test(name));
        } catch (readError) {
          if (readError.code === 'ENOENT') continue;
          throw readError;
        }
        if (!entries.length) {
          try {
            await rmdir(paths.lock);
          } catch (emptyError) {
            if (!['ENOENT', 'ENOTEMPTY'].includes(emptyError.code)) throw emptyError;
          }
          continue;
        }
        if (!owners.length)
          throw new Error('The E2E worker lease has no valid owner record.', { cause: error });
        if (owners.length !== 1)
          throw new Error('The E2E worker lease has multiple owner records.', { cause: error });
        const oldPaths = leasePaths(lane, slot, owners[0]);
        const owner = await readOwner(oldPaths.owner);
        if (!owner) continue;
        if (processExists(owner.pid))
          throw new Error(`E2E worker slot is already owned by live process ${owner.pid}.`, {
            cause: error,
          });
        await waitForRecordedGroups(owner.groups);
        // A delayed reaper removes only this dead owner's unique filename. A successor's
        // distinct owner keeps its directory nonempty and therefore cannot be removed.
        await releaseLease(oldPaths);
        recovered = true;
      }
    }
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}

function makeChild(label) {
  const child = spawn(process.execPath, [join(root, 'scripts/e2eProcessGuardian.mjs')], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  let stdout = '';
  let spawnError;
  const outputsClosed = new Promise((resolveClose) => child.once('close', resolveClose));
  const childExited = new Promise((resolveExit) => child.once('exit', resolveExit));
  const waitForClose = () =>
    Promise.race([
      childExited,
      sleep(5_000).then(() => {
        throw new Error(`${label} guardian did not stop within 5,000 ms.`);
      }),
    ]);
  const keepTail = (current, chunk) => `${current}${chunk}`.slice(-12_000);
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout = keepTail(stdout, chunk);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr = keepTail(stderr, chunk);
  });
  child.on('error', (error) => {
    spawnError = error;
    stderr = keepTail(stderr, `\n${error.stack ?? error.message}`);
  });
  return {
    label,
    child,
    get stderr() {
      return stderr;
    },
    get stdout() {
      return stdout;
    },
    get spawnError() {
      return spawnError;
    },
    get group() {
      return child.pid;
    },
    start(command, args, options) {
      if (!child.connected) throw new Error(`${label} guardian disconnected before START.`);
      child.send({ type: 'START', command, args, options });
    },
    requestStop() {
      if (child.connected) child.send({ type: 'STOP' });
    },
    waitForClose,
    closeOutputs() {
      return Promise.race([outputsClosed, sleep(100)]);
    },
  };
}

function exitError(processRecord) {
  const { child, label, stderr, stdout } = processRecord;
  return new Error(
    `${label} exited before readiness (code ${child.exitCode}, signal ${child.signalCode}).\n${stderr || stdout || '(no output captured)'}`,
  );
}

async function waitReady(processRecord, url, description, watched = [processRecord]) {
  const child = processRecord.child;
  const deadline = Date.now() + readinessTimeoutMs;
  while (Date.now() < deadline) {
    const exited = watched.find(
      (record) =>
        record.spawnError || record.child.exitCode !== null || record.child.signalCode !== null,
    );
    if (exited) {
      await exited.closeOutputs();
      throw exitError(exited);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      if (processRecord.spawnError || child.exitCode !== null || child.signalCode !== null) {
        await processRecord.closeOutputs();
        throw exitError(processRecord);
      }
    }
    await sleep(100);
  }
  throw new Error(
    `${description} did not become ready at ${url} within ${readinessTimeoutMs} ms.\n${processRecord.stderr || processRecord.stdout}`,
  );
}

async function assertPortsFree(apiPort, webPort) {
  const [apiOccupied, webOccupied] = await Promise.all([portInUse(apiPort), portInUse(webPort)]);
  if (apiOccupied || webOccupied) {
    const occupied = [apiOccupied && `API ${apiPort}`, webOccupied && `web ${webPort}`]
      .filter(Boolean)
      .join(' and ');
    throw new Error(`E2E worker ${occupied} port is occupied; refusing to remove its database.`);
  }
}

async function removeDatabaseFiles(target) {
  for (const suffix of ['', '-wal', '-shm'])
    await rm(`${target.databasePath}${suffix}`, { force: true });
  await rm(target.templatePath, { force: true });
}

class BusyWorkerError extends Error {}

async function assertProxyDrained(webOrigin) {
  const response = await fetch(`${webOrigin}/__e2e/active-proxies`, {
    signal: AbortSignal.timeout(1_000),
  });
  if (!response.ok) throw new Error(`Worker Vite drain probe returned HTTP ${response.status}.`);
  const value = await response.json();
  if (
    !Number.isInteger(value.activeRequests) ||
    value.activeRequests < 0 ||
    !Number.isInteger(value.openSockets) ||
    value.openSockets < 0
  )
    throw new Error('Worker Vite drain probe returned an invalid active request count.');
  if (value.activeRequests !== 0 || value.openSockets !== 0)
    throw new BusyWorkerError(
      `Refusing database reset while Vite has ${value.activeRequests} active API requests and ${value.openSockets} open upstream sockets.`,
    );
}

async function assertRequestsDrained(apiOrigin) {
  const response = await fetch(`${apiOrigin}/api/health/e2e-idle`, {
    signal: AbortSignal.timeout(1_000),
  });
  if (!response.ok) throw new Error(`Worker API drain probe returned HTTP ${response.status}.`);
  const value = await response.json();
  if (!Number.isInteger(value.activeRequests) || value.activeRequests < 0)
    throw new Error('Worker API drain probe returned an invalid active request count.');
  if (value.activeRequests !== 0)
    throw new BusyWorkerError(
      `Refusing database reset while the API has ${value.activeRequests} active requests.`,
    );
}

/** Wait briefly for cancelled clients' proxy sockets and backend handlers to complete. */
async function waitForWorkerDrain(target, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await assertProxyDrained(target.web);
      await assertRequestsDrained(target.api);
      return;
    } catch (error) {
      if (!(error instanceof BusyWorkerError) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/** Starts an isolated API/Vite pair for one Playwright parallelIndex and owns their lifecycle. */
export async function startE2eWorkerServer(target, lane = resolveLane(), slot = 0) {
  const ports = workerPorts(lane, slot);
  const viteCachePath = cachePath(lane, slot);
  const lease = await acquireLease(lane, slot);
  const { paths } = lease;
  const processes = [];
  let stopped = false;
  let databaseOwned = false;

  const writeOwner = () => {
    const ownerTmp = `${paths.owner}.${process.pid}.tmp`;
    const contents = JSON.stringify({
      pid: process.pid,
      groups: processes.map(({ group }) => group).filter((group) => Number.isInteger(group)),
    });
    writeFileSync(ownerTmp, contents, { mode: 0o600 });
    renameSync(ownerTmp, paths.owner);
  };

  const stop = async ({ removeDatabase = true, removeCache = true } = {}) => {
    if (stopped) return;
    stopped = true;
    let terminationError;
    for (const record of [...processes].reverse()) {
      try {
        record.requestStop();
        await record.waitForClose();
      } catch (error) {
        terminationError ??= error;
      }
    }
    try {
      await waitForRecordedGroups(processes.map(({ group }) => group).filter(Number.isInteger));
    } catch (error) {
      terminationError ??= error;
    }
    if (!terminationError) {
      if (removeDatabase) await removeDatabaseFiles(target);
      if (removeCache) await rm(viteCachePath, { recursive: true, force: true });
      await releaseLease(paths);
    }
    if (terminationError) throw terminationError;
  };

  try {
    await assertPortsFree(ports.api, ports.web);
    if (lease.recovered) {
      await removeDatabaseFiles(target);
      await rm(viteCachePath, { recursive: true, force: true });
    }
    const api = makeChild('E2E API server');
    processes.push(api);
    writeOwner();
    api.start(
      process.execPath,
      [join(backend, 'scripts/e2e-server.mjs'), 'db', '--slot', String(slot)],
      {
        cwd: root,
        env: {
          ...process.env,
          CAPACITYLENS_PORT_LANE: String(lane),
          CAPACITYLENS_E2E_WORKER_API: '1',
        },
      },
    );
    await waitReady(api, `${target.api}/health/ready`, 'E2E API server');
    databaseOwned = true;

    const vite = makeChild('E2E Vite server');
    processes.push(vite);
    writeOwner();
    vite.start(
      'pnpm',
      [
        '--dir',
        'apps/frontend',
        'exec',
        'vite',
        '--host',
        '127.0.0.1',
        '--port',
        String(ports.web),
        '--strictPort',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CAPACITYLENS_PORT_LANE: String(lane),
          CAPACITYLENS_E2E_WORKER: '1',
          CAPACITYLENS_VITE_PORT: String(ports.web),
          CAPACITYLENS_VITE_CACHE_DIR: viteCachePath,
          CAPACITYLENS_DEV_API_PORT: String(ports.api),
          VITE_CAPACITYLENS_API: '',
          VITE_CAPACITYLENS_BUILD_SHA: '',
          VITE_CAPACITYLENS_FEEDBACK_MAILTO: '',
        },
      },
    );
    await waitReady(vite, `${target.web}/health/ready`, 'E2E Vite proxy', processes);

    return {
      target,
      baseURL: target.web,
      async assertDrained() {
        await assertProxyDrained(target.web);
        await assertRequestsDrained(target.api);
      },
      async waitUntilDrained() {
        await waitForWorkerDrain(target);
      },
      async stop() {
        await stop();
      },
    };
  } catch (error) {
    try {
      const apiPassedCollisionCheck = processes.some(
        (record) =>
          record.label === 'E2E API server' &&
          record.stdout.includes('E2E_WORKER_SLOT_READY_FOR_RESET'),
      );
      await stop({ removeDatabase: databaseOwned || apiPassedCollisionCheck });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'E2E worker startup and cleanup failed.', {
        cause: cleanupError,
      });
    }
    throw error;
  }
}

/** Remove files created by a worker after a crash, once its process groups have exited. */
export async function recoverE2eWorker(target, lane = resolveLane(), slot = 0) {
  const lease = await acquireLease(lane, slot);
  try {
    const ports = workerPorts(lane, slot);
    await assertPortsFree(ports.api, ports.web);
    await removeDatabaseFiles(target);
    await rm(cachePath(lane, slot), { recursive: true, force: true });
  } finally {
    await releaseLease(lease.paths);
  }
}

export {
  waitForWorkerDrain as waitForE2eWorkerDrain,
  acquireLease as acquireE2eWorkerLease,
  releaseLease as releaseE2eWorkerLease,
  assertProxyDrained as assertE2eProxyDrained,
  assertRequestsDrained as assertE2eRequestsDrained,
};
