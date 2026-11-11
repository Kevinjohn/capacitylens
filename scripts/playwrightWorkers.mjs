import { readFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { testShare, WORKER_SLOTS_PER_LANE } from './ports.mjs';
import { resolvePlaywrightRunMode } from './playwrightRunMode.mjs';

// Baseline full-stack RSS in KiB: API tree, warmed Vite tree and largest representative browser worker/tree (WebKit).
export const AUTH_SERVER_MEMORY_BYTES = (671568 + 890832) * 1024;
export const WORKER_MEMORY_BYTES = AUTH_SERVER_MEMORY_BYTES + 1537376 * 1024;

/** Read usable RAM, including reclaimable caches on Linux; other platforms use free RAM. */
export function availableMemoryBytes() {
  if (process.platform !== 'linux') return freemem();
  const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'));
  if (!available) throw new Error('Cannot determine available memory for browser workers.');
  return Number(available[1]) * 1024;
}

/** Bound isolated full-stack browser workers by the run's CPU share, port slots and measured RAM. */
export function browserWorkerCount(
  environment = process.env,
  {
    freeBytes = availableMemoryBytes(),
    workerBytes = WORKER_MEMORY_BYTES,
    reservedBytes = resolvePlaywrightRunMode(environment).serverProfile === 'standard'
      ? AUTH_SERVER_MEMORY_BYTES
      : 0,
  } = {},
) {
  if (
    !Number.isFinite(freeBytes) ||
    freeBytes < 0 ||
    !Number.isFinite(workerBytes) ||
    workerBytes <= 0 ||
    !Number.isFinite(reservedBytes) ||
    reservedBytes < 0
  )
    throw new RangeError(
      'Browser worker memory must be finite and non-negative, with a positive worker cost.',
    );
  const usableBytes = Math.max(0, freeBytes - reservedBytes);
  const memorySlots = Math.floor(usableBytes / workerBytes);
  if (memorySlots === 0) {
    throw new Error(
      `insufficient memory for one worker: needs ${Math.ceil(workerBytes / 1024 ** 2)} MB, has ${Math.floor(usableBytes / 1024 ** 2)} MB`,
    );
  }
  return Math.min(testShare(environment), WORKER_SLOTS_PER_LANE, memorySlots);
}
