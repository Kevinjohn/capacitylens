import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireExclusiveFile, terminateProcessTree } from './devProcesses.mjs';

class FakeChild extends EventEmitter {
  constructor(pid = 1234) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
  }

  exit(signal) {
    this.signalCode = signal;
    this.emit('exit', null, signal);
  }
}

test('exclusive files reject a second owner and are reusable after release', () => {
  const directory = mkdtempSync(join(tmpdir(), 'capacitylens-process-test-'));
  const path = join(directory, 'launcher.lock');
  try {
    const release = acquireExclusiveFile(path);
    assert.throws(() => acquireExclusiveFile(path), { code: 'EEXIST' });
    release();
    release();
    assert.equal(existsSync(path), false);
    const releaseAgain = acquireExclusiveFile(path);
    releaseAgain();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a graceful POSIX tree exit avoids force escalation', async () => {
  const child = new FakeChild();
  const signals = [];
  await terminateProcessTree(child, {
    platform: 'darwin',
    graceMs: 5,
    forceMs: 5,
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      child.exit(signal);
    },
  });
  assert.deepEqual(signals, [[-1234, 'SIGTERM']]);
});

test('an unresponsive POSIX tree escalates from SIGTERM to SIGKILL', async () => {
  const child = new FakeChild();
  const signals = [];
  await terminateProcessTree(child, {
    platform: 'linux',
    graceMs: 1,
    forceMs: 5,
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGKILL') child.exit(signal);
    },
  });
  assert.deepEqual(signals, [
    [-1234, 'SIGTERM'],
    [-1234, 'SIGKILL'],
  ]);
});

test('a POSIX group is escalated when its root exits but a descendant ignores SIGTERM', async (t) => {
  if (process.platform === 'win32')
    return t.skip('POSIX process groups are unavailable on Windows');

  const root = spawn(
    process.execPath,
    [
      '-e',
      `const { spawn } = require('node:child_process');
       const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
       descendant.stdout.once('data', () => console.log(descendant.pid));
       process.on('SIGTERM', () => process.exit(0));
       setInterval(() => {}, 1000);`,
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let descendantPid;
  t.after(() => {
    const errors = [];
    if (Number.isInteger(root.pid) && root.pid > 0) {
      try {
        process.kill(-root.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') errors.push(error);
      }
    }
    for (const pid of [root.pid, descendantPid].filter(
      (value) => Number.isInteger(value) && value > 0,
    )) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, 'failed to clean up the owned POSIX process group');
  });
  let output = '';
  root.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
  descendantPid = await new Promise((resolve, reject) => {
    const finish = (error, pid) => {
      clearTimeout(timeout);
      root.stdout.off('data', onReady);
      root.off('exit', onExit);
      root.off('error', onError);
      if (error) reject(error);
      else resolve(pid);
    };
    const onReady = () => finish(null, Number(output.trim()));
    const onExit = (code, signal) =>
      finish(
        new Error(`process-group root exited before descendant readiness (${code ?? signal})`),
      );
    const onError = (error) => finish(error);
    const timeout = setTimeout(
      () => finish(new Error('owned descendant did not become ready within 3 seconds')),
      3_000,
    );
    root.stdout.once('data', onReady);
    root.once('exit', onExit);
    root.once('error', onError);
  });
  assert.ok(descendantPid > 0, `expected a descendant PID, received ${output.trim()}`);
  process.kill(-root.pid, 0);
  const startedAt = Date.now();
  await terminateProcessTree(root, { graceMs: 100, forceMs: 250 });
  assert.ok(Date.now() - startedAt < 1_500, 'cleanup should have a bounded outcome');

  // A dead process can briefly remain as a zombie until its new parent reaps it.
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    try {
      process.kill(descendantPid, 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
  }
  assert.fail(`owned descendant ${descendantPid} survived cleanup (root output: ${output.trim()})`);
});

test('an unresponsive Windows tree escalates to forced taskkill', async () => {
  const child = new FakeChild(4321);
  const invocations = [];
  await terminateProcessTree(child, {
    platform: 'win32',
    graceMs: 1,
    forceMs: 5,
    spawnProcess: (command, args) => {
      invocations.push([command, args]);
      if (args.includes('/F')) child.exit('SIGKILL');
      return new FakeChild();
    },
  });
  assert.deepEqual(invocations, [
    ['taskkill', ['/pid', '4321', '/T']],
    ['taskkill', ['/pid', '4321', '/T', '/F']],
  ]);
});

test('a child that failed to start has no PID to signal', async () => {
  const child = new FakeChild();
  child.pid = undefined;
  const invocations = [];
  await terminateProcessTree(child, {
    platform: 'win32',
    spawnProcess: (...args) => {
      invocations.push(args);
      return new FakeChild();
    },
  });
  assert.deepEqual(invocations, []);
});
