import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { workerPorts } from './ports.mjs';
import { startE2eWorkerServer, recoverE2eWorker } from './e2eWorkerRuntime.mjs';

const lane = 9;
const slot = 49;
const target = (databasePath, apiPort, webPort) => ({
  lane,
  slot,
  api: `http://127.0.0.1:${apiPort}`,
  web: `http://127.0.0.1:${webPort}`,
  databasePath,
  templatePath: `${databasePath}.template`,
});

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

test('occupied API and web endpoints leave the existing database untouched', async () => {
  const ports = workerPorts(lane, slot);
  for (const [kind, port] of [
    ['API', ports.api],
    ['web', ports.web],
  ]) {
    const temp = join(tmpdir(), `capacitylens-e2e-collision-${kind}-${process.pid}.db`);
    await writeFile(temp, 'preserve this database');
    const listener = await listen(port);
    try {
      await assert.rejects(
        startE2eWorkerServer(target(temp, ports.api, ports.web), lane, slot),
        new RegExp(`${kind} \\d+ port is occupied; refusing to remove its database`),
      );
      assert.equal(await readFile(temp, 'utf8'), 'preserve this database');
    } finally {
      await new Promise((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(temp, { force: true });
    }
  }
});

test(
  'a stale worker lease terminates its descendant tree before deleting slot files',
  { skip: process.platform === 'win32' },
  async () => {
    const db = join(tmpdir(), `capacitylens-e2e-stale-${process.pid}.db`);
    const cache = join(process.cwd(), 'node_modules', `.vite-e2e-l${lane}-w${slot}`);
    const leaseDirectory = join(tmpdir(), 'capacitylens-e2e-workers');
    const id = `l${lane}-w${slot}`;
    const lock = join(leaseDirectory, `${id}.lock`);
    const ownerName = 'owner-999999999-dead.json';
    const owner = join(lock, ownerName);
    await mkdir(leaseDirectory, { recursive: true });
    await mkdir(lock, { recursive: true });
    await mkdir(cache, { recursive: true });
    await writeFile(db, 'stale');
    await writeFile(`${db}.template`, 'stale template');
    const parentScript = `
    import { spawn } from 'node:child_process';
    const grandchild = spawn(process.execPath, ['-e', "process.stdout.write('READY'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
    let announced = false;
    grandchild.stdout.on('data', (chunk) => {
      if (!announced && chunk.toString().includes('READY')) {
        announced = true;
        process.send({ type: 'ready', pid: grandchild.pid });
      }
    });
    process.on('SIGTERM', () => {
      grandchild.kill('SIGTERM');
      grandchild.once('exit', (code, signal) => {
        process.send({ type: 'reaped', code, signal });
        process.exit(0);
      });
    });
    setInterval(() => {}, 1000);
  `;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', parentScript], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    assert.ok(parent.pid);
    const ready = new Promise((resolve, reject) => {
      parent.once('error', reject);
      parent.on('message', (message) => {
        if (message.type === 'ready') resolve(message.pid);
      });
      parent.once('exit', (code, signal) => {
        reject(
          new Error(`Process fixture exited before readiness (code ${code}, signal ${signal}).`),
        );
      });
    });
    const parentReaped = new Promise((resolve) => {
      parent.on('message', (message) => {
        if (message.type === 'reaped') resolve(message);
      });
    });
    const parentExited = new Promise((resolve, reject) => {
      parent.once('error', reject);
      parent.once('exit', (code, signal) => resolve({ code, signal }));
    });

    let grandchildPid;
    let failure;
    try {
      grandchildPid = await ready;
      await writeFile(owner, JSON.stringify({ pid: 999_999_999, groups: [parent.pid] }));
      await recoverE2eWorker(target(db, 1, 2), lane, slot);
      const reaped = await Promise.race([
        parentReaped,
        parentExited.then(() => {
          throw new Error('Process fixture exited without confirming that it reaped its child.');
        }),
      ]);
      assert.deepEqual(reaped, { type: 'reaped', code: null, signal: 'SIGTERM' });
      assert.deepEqual(await parentExited, { code: 0, signal: null });
      const exists = async (path) =>
        access(path).then(
          () => true,
          () => false,
        );
      assert.equal(await exists(db), false);
      assert.equal(await exists(`${db}.template`), false);
      assert.equal(await exists(cache), false);
      assert.equal(await exists(owner), false);
      assert.equal(await exists(lock), false);
      assert.throws(() => process.kill(parent.pid, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(grandchildPid, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(-parent.pid, 0), { code: 'ESRCH' });
    } catch (error) {
      failure = error;
    }
    let cleanupFailure;
    try {
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/pid', String(parent.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-parent.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') cleanupFailure = error;
    }
    await rm(db, { force: true });
    await rm(`${db}.template`, { force: true });
    await rm(cache, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
    if (failure && cleanupFailure)
      throw new AggregateError(
        [failure, cleanupFailure],
        'Worker recovery and test cleanup failed.',
        {
          cause: cleanupFailure,
        },
      );
    if (failure) throw failure;
    if (cleanupFailure) throw cleanupFailure;
  },
);

test(
  'concurrent stale-owner reapers cannot remove the successor lease',
  { skip: process.platform === 'win32' },
  async () => {
    const leaseDirectory = join(tmpdir(), 'capacitylens-e2e-workers');
    const lock = join(leaseDirectory, `l${lane}-w${slot}.lock`);
    const ownerPath = join(lock, 'owner-999999999-dead.json');
    await mkdir(lock, { recursive: true });
    const owner = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
    process.on('SIGTERM', () => process.send({ type: 'sigterm' }));
    process.on('message', (message) => { if (message.type === 'exit') process.exit(0); });
    process.send({ type: 'ready' });
    setInterval(() => {}, 1000);
  `,
      ],
      { detached: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
    );
    assert.ok(owner.pid);
    const ownerReady = new Promise((resolve, reject) => {
      owner.once('error', reject);
      owner.on('message', (message) => {
        if (message.type === 'ready') resolve();
      });
    });
    const termMessages = [];
    const nextTerm = () =>
      new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        const onMessage = (message) => {
          if (message.type !== 'sigterm') return;
          owner.off('error', onError);
          owner.off('message', onMessage);
          termMessages.push(message);
          resolve(message);
        };
        owner.once('error', onError);
        owner.on('message', onMessage);
      });
    const cleanup = async () => {
      try {
        owner.kill('SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      try {
        process.kill(-owner.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      await rm(lock, { recursive: true, force: true });
    };
    try {
      await ownerReady;
      await writeFile(ownerPath, JSON.stringify({ pid: 999_999_999, groups: [owner.pid] }));
      const firstSignal = nextTerm();
      const first = import('./e2eWorkerRuntime.mjs').then(({ acquireE2eWorkerLease }) =>
        acquireE2eWorkerLease(lane, slot),
      );
      await firstSignal;

      const secondSignal = nextTerm();
      const second = import('./e2eWorkerRuntime.mjs').then(({ acquireE2eWorkerLease }) =>
        acquireE2eWorkerLease(lane, slot),
      );
      await secondSignal;

      owner.send({ type: 'exit' });
      const outcomes = await Promise.allSettled([first, second]);
      const leases = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
      assert.equal(termMessages.length, 2);
      assert.equal(leases.length, 1);
      assert.equal(failures.length, 1);
      assert.match(failures[0].reason.message, /already owned by live process/);

      const lease = leases[0].value;
      const ownerFiles = await readdir(lease.paths.lock);
      assert.deepEqual(ownerFiles, [lease.paths.owner.split('/').at(-1)]);
      assert.equal(JSON.parse(await readFile(lease.paths.owner, 'utf8')).pid, process.pid);
      const { releaseE2eWorkerLease } = await import('./e2eWorkerRuntime.mjs');
      await releaseE2eWorkerLease(lease.paths);
    } finally {
      await cleanup();
    }
  },
);
