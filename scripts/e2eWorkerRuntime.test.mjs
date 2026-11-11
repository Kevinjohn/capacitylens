import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveLane, workerPorts } from './ports.mjs';
import { startE2eWorkerServer, recoverE2eWorker } from './e2eWorkerRuntime.mjs';

const lane = resolveLane();
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
  'the real E2E API launcher failure reaches the guardian stderr stream',
  { skip: process.platform === 'win32' },
  async () => {
    const ports = workerPorts(lane, slot);
    const listener = await listen(ports.api);
    const guardian = spawn(
      process.execPath,
      [new URL('./e2eProcessGuardian.mjs', import.meta.url).pathname],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    let stderr = '';
    guardian.stdout.on('data', () => {});
    guardian.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    const exited = new Promise((resolve, reject) => {
      guardian.once('error', reject);
      guardian.once('exit', resolve);
    });
    try {
      await new Promise((resolve, reject) => {
        guardian.once('spawn', resolve);
        guardian.once('error', reject);
      });
      guardian.send({
        type: 'START',
        command: process.execPath,
        args: [
          join(process.cwd(), 'apps/backend/scripts/e2e-server.mjs'),
          'db',
          '--slot',
          String(slot),
        ],
        options: {
          cwd: process.cwd(),
          env: { ...process.env, CAPACITYLENS_PORT_LANE: String(lane) },
        },
      });
      await exited;
      assert.match(
        stderr,
        new RegExp(
          `Worker API ${ports.api} port is already occupied; refusing to replace its database`,
        ),
      );
    } finally {
      if (guardian.connected) guardian.disconnect();
      await new Promise((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

test(
  'a normal guardian stop terminates its service group before exit',
  { skip: process.platform === 'win32' },
  async () => {
    const guardian = spawn(
      process.execPath,
      [new URL('./e2eProcessGuardian.mjs', import.meta.url).pathname],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    guardian.stderr.on('data', () => {});
    let readyResolve;
    const ready = new Promise((resolve) => (readyResolve = resolve));
    guardian.stdout.setEncoding('utf8').on('data', (chunk) => {
      if (chunk.includes('NORMAL_STOP_READY')) readyResolve();
    });
    const exited = new Promise((resolve, reject) => {
      guardian.once('error', reject);
      guardian.once('exit', resolve);
    });
    try {
      await new Promise((resolve, reject) => {
        guardian.once('spawn', resolve);
        guardian.once('error', reject);
      });
      guardian.send({
        type: 'START',
        command: process.execPath,
        args: ['-e', "console.log('NORMAL_STOP_READY'); setInterval(() => {}, 1000)"],
        options: {},
      });
      await ready;
      guardian.send({ type: 'STOP' });
      await exited;
      assert.throws(() => process.kill(-guardian.pid, 0), { code: 'ESRCH' });
    } finally {
      if (guardian.connected) guardian.disconnect();
    }
  },
);

test(
  'guardian disconnect cleans each crash stage before stale lease recovery removes files',
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
    const runtime = await import('./e2eWorkerRuntime.mjs');
    const guardianScript = new URL('./e2eProcessGuardian.mjs', import.meta.url);
    const waitExit = (child) =>
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
    const makeGuardian = async () => {
      const guardian = spawn(process.execPath, [guardianScript.pathname], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      guardian.stdout.on('data', () => {});
      guardian.stderr.on('data', () => {});
      await new Promise((resolve, reject) => {
        guardian.once('spawn', resolve);
        guardian.once('error', reject);
      });
      return guardian;
    };
    const resetLease = async () => rm(lock, { recursive: true, force: true });
    const putOwner = async (groups) => {
      await mkdir(lock, { recursive: true });
      await writeFile(owner, JSON.stringify({ pid: 999_999_999, groups }));
    };
    try {
      // Crash after spawn but before recording the guardian: no service has been STARTed.
      await putOwner([]);
      const unrecorded = await makeGuardian();
      const unrecordedExit = waitExit(unrecorded);
      unrecorded.disconnect();
      await unrecordedExit;
      assert.throws(() => process.kill(-unrecorded.pid, 0), { code: 'ESRCH' });
      await writeFile(db, 'stale pre-record');
      await runtime.recoverE2eWorker(target(db, 1, 2), lane, slot);
      await assert.rejects(access(db), { code: 'ENOENT' });

      // Crash after the guardian PID is atomically recorded but before START.
      await resetLease();
      const recorded = await makeGuardian();
      await putOwner([recorded.pid]);
      const recordedExit = waitExit(recorded);
      recorded.disconnect();
      await recordedExit;
      await writeFile(db, 'stale');
      await writeFile(`${db}.template`, 'stale template');
      await mkdir(cache, { recursive: true });
      await runtime.recoverE2eWorker(target(db, 1, 2), lane, slot);
      await assert.rejects(access(db), { code: 'ENOENT' });
      await assert.rejects(access(`${db}.template`), { code: 'ENOENT' });
      await assert.rejects(access(owner), { code: 'ENOENT' });

      // Crash while active; a TERM-ignoring grandchild must be gone after guardian escalation.
      const active = await makeGuardian();
      const activeExit = waitExit(active);
      const output = new Promise((resolve, reject) => {
        let buffered = '';
        active.stdout.setEncoding('utf8').on('data', (chunk) => {
          buffered += chunk;
          const match = /DESCENDANT_READY:(\d+)/.exec(buffered);
          if (match) resolve(Number(match[1]));
        });
        active.once('error', reject);
      });
      await putOwner([active.pid]);
      active.send({
        type: 'START',
        command: process.execPath,
        args: [
          '-e',
          "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'}); console.log('DESCENDANT_READY:'+c.pid); setInterval(()=>{},1000)",
        ],
        options: {},
      });
      const descendantPid = await output;
      await new Promise((resolve) => setTimeout(resolve, 100));
      active.disconnect();
      await activeExit;
      await writeFile(db, 'stale active');
      await runtime.recoverE2eWorker(target(db, 1, 2), lane, slot);
      assert.throws(() => process.kill(-active.pid, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
      assert.equal(
        await access(db).then(
          () => true,
          () => false,
        ),
        false,
      );
    } finally {
      await rm(db, { force: true });
      await rm(`${db}.template`, { force: true });
      await rm(cache, { recursive: true, force: true });
      await resetLease();
    }
  },
);

test(
  'a live process group from a stale record is never signalled and keeps its files',
  { skip: process.platform === 'win32' },
  async () => {
    const db = join(tmpdir(), `capacitylens-e2e-preserved-${process.pid}.db`);
    const lock = join(tmpdir(), 'capacitylens-e2e-workers', `l${lane}-w${slot}.lock`);
    const ownerPath = join(lock, 'owner-999999999-dead.json');
    await mkdir(lock, { recursive: true });
    await writeFile(db, 'preserve');
    await writeFile(`${db}.template`, 'preserve template');
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    });
    assert.ok(unrelated.pid);
    let cleanupError;
    try {
      await new Promise((resolve, reject) => {
        unrelated.once('spawn', resolve);
        unrelated.once('error', reject);
      });
      await writeFile(ownerPath, JSON.stringify({ pid: 999_999_999, groups: [unrelated.pid] }));
      await assert.rejects(
        recoverE2eWorker(target(db, 1, 2), lane, slot),
        /preserving the lease and worker files/,
      );
      assert.equal(await readFile(db, 'utf8'), 'preserve');
      assert.equal(await readFile(`${db}.template`, 'utf8'), 'preserve template');
      assert.equal(
        await access(ownerPath).then(
          () => true,
          () => false,
        ),
        true,
      );
      assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    } finally {
      try {
        process.kill(-unrelated.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') cleanupError = error;
      }
      await rm(db, { force: true });
      await rm(`${db}.template`, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
    if (cleanupError) throw cleanupError;
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
      const first = import('./e2eWorkerRuntime.mjs').then(({ acquireE2eWorkerLease }) =>
        acquireE2eWorkerLease(lane, slot),
      );
      const second = import('./e2eWorkerRuntime.mjs').then(({ acquireE2eWorkerLease }) =>
        acquireE2eWorkerLease(lane, slot),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      owner.send({ type: 'exit' });
      const outcomes = await Promise.allSettled([first, second]);
      const leases = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
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
