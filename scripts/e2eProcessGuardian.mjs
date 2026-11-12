import { spawn } from 'node:child_process';
import { spawnPnpm } from './pnpmSpawn.mjs';

const graceMs = 2_000;
let started = false;
let stopping = false;
let service;
let stopTimer;

function terminateGroup(signal) {
  if (process.platform === 'win32') {
    if (!service?.pid) return;
    const args = ['/pid', String(service.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])];
    spawn('taskkill', args, { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-process.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function stop() {
  if (stopping) return;
  stopping = true;
  if (!service) {
    process.exit(0);
    return;
  }
  if (service.exitCode === null && service.signalCode === null) {
    try {
      service.kill('SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') process.stderr.write(`${error.stack ?? error.message}\n`);
    }
  }
  try {
    terminateGroup('SIGTERM');
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
  }
  stopTimer = setTimeout(() => {
    try {
      terminateGroup('SIGKILL');
      if (process.platform === 'win32') process.exit(0);
    } catch (error) {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
      process.exit();
    }
  }, graceMs);
}

// stop() is idempotent, so the TERM sent to the whole group leaves the guardian
// alive through escalation while a direct TERM also initiates cleanup.
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
process.on('message', (message) => {
  if (message?.type === 'STOP') return stop();
  if (message?.type !== 'START' || started || stopping) return;
  started = true;
  try {
    const { command, args, options } = message;
    const spawnOptions = {
      ...options,
      detached: false,
      stdio: 'inherit',
    };
    service =
      command === 'pnpm' ? spawnPnpm(args, spawnOptions) : spawn(command, args, spawnOptions);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    stop();
    return;
  }
  service.once('error', (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
    stop();
  });
  service.once('exit', () => {
    if (!stopping) stop();
  });
});

process.on('exit', () => clearTimeout(stopTimer));
