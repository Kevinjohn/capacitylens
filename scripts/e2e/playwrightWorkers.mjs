import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { freemem } from 'node:os'
import { testShare, WORKER_SLOTS_PER_PORT_LANE } from '../../tooling/ports.mjs'
import { resolvePlaywrightRunMode } from './playwrightRunMode.mjs'

// Baseline RSS in KiB: API tree, warmed Vite tree and largest representative browser worker/tree
// (WebKit). The auth project still runs one API and one Vite server; a database worker runs only an
// API, which serves the built SPA.
const API_TREE_KIB = 671568
const VITE_TREE_KIB = 890832
const BROWSER_TREE_KIB = 1537376
export const AUTH_SERVER_MEMORY_BYTES = (API_TREE_KIB + VITE_TREE_KIB) * 1024
// Measured E2E guardians were 59,436 and 59,348 KiB at API/Vite readiness, and at most 48,368 KiB
// across full API-only WebKit and Firefox runs; reserve 64 MiB for runtime and platform variation.
export const E2E_GUARDIAN_MEMORY_BYTES = 64 * 1024 ** 2
export const WORKER_MEMORY_BYTES =
  (API_TREE_KIB + BROWSER_TREE_KIB) * 1024 + E2E_GUARDIAN_MEMORY_BYTES

/**
 * Usable RAM from `vm_stat` output. macOS keeps most unused memory as inactive, speculative or
 * purgeable pages and hands them back on demand, so free pages alone understate what a run can use.
 */
export function macosAvailableMemoryBytes(vmStat) {
  const pageSize = /page size of (\d+) bytes/.exec(vmStat)
  const pages = ['free', 'inactive', 'speculative', 'purgeable'].map((kind) =>
    new RegExp(String.raw`^Pages ${kind}:\s+(\d+)\.$`, 'm').exec(vmStat)
  )
  if (!pageSize || pages.includes(null))
    throw new Error('Cannot determine available memory for browser workers.')
  return pages.reduce((total, match) => total + Number(match[1]), 0) * Number(pageSize[1])
}

/** Read usable RAM, including reclaimable memory on Linux and macOS; other platforms use free RAM. */
export function availableMemoryBytes() {
  if (process.platform === 'darwin')
    return macosAvailableMemoryBytes(execFileSync('/usr/bin/vm_stat', { encoding: 'utf8' }))
  if (process.platform !== 'linux') return freemem()
  const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'))
  if (!available) throw new Error('Cannot determine available memory for browser workers.')
  return Number(available[1]) * 1024
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
  } = {}
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
      'Browser worker memory must be finite and non-negative, with a positive worker cost.'
    )
  const usableBytes = Math.max(0, freeBytes - reservedBytes)
  const memorySlots = Math.floor(usableBytes / workerBytes)
  if (memorySlots === 0) {
    throw new Error(
      `insufficient memory for one worker: needs ${Math.ceil(workerBytes / 1024 ** 2)} MB, has ${Math.floor(usableBytes / 1024 ** 2)} MB`
    )
  }
  return Math.min(testShare(environment), WORKER_SLOTS_PER_PORT_LANE, memorySlots)
}

const ADMITTED_WORKERS = 'CAPACITYLENS_E2E_ADMITTED_WORKERS'

/** Admit once in the coordinator; worker config reloads reuse that decision after servers start. */
export function configurationWorkerCount(environment = process.env, memory) {
  if (environment.TEST_WORKER_INDEX !== undefined) {
    const admitted = environment[ADMITTED_WORKERS]
    if (!admitted || !/^[1-9]\d*$/.test(admitted) || Number(admitted) > WORKER_SLOTS_PER_PORT_LANE)
      throw new Error('Playwright worker is missing a valid coordinator memory admission.')
    return Number(admitted)
  }
  const count = browserWorkerCount(environment, memory)
  environment[ADMITTED_WORKERS] = String(count)
  return count
}
