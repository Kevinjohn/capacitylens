// Each long-running local server uses a lane-derived port. A lane is an integer from 0–9, and each
// port is `base + lane`, so ten concurrent worktrees do not overlap. Lane 0 preserves the ports
// used by CI, documentation, and a single checkout.
//
// This module is pure: it maps a lane to ports and reads already-resolved environment values.
// Claiming a lane (and the CPU reservation that rides with it) lives in scripts/laneClaims.mjs,
// and scripts/with-lane.mjs is the launcher that owns both for the lifetime of a command.
// Configuration files must only ever READ: see the note on LANE_ENVIRONMENT_KEY below.
import { availableParallelism } from "node:os";

// Ten lanes, deliberately. The auth API base is spaced from other lane bases so each
// checkout receives a disjoint service set.
export const LANE_CEILING = 10;

// Set by scripts/with-lane.mjs on the child environment; read by every config and helper. A config
// file that tried to CLAIM a lane instead of reading this would claim too late to matter:
// playwright.config.ts has already materialised its ports by the time its globalSetup runs.
export const LANE_ENVIRONMENT_KEY = "CAPACITYLENS_PORT_LANE";
export const LANE_CLAIM_ENVIRONMENT_KEY = "CAPACITYLENS_LANE_CLAIM";
export const SHARE_ENVIRONMENT_KEY = "CAPACITYLENS_TEST_SHARE";

// Lane 0 of each base is the port this repository bound before lanes existed. Keep it that way:
// every URL in the documentation, in CI and in a single checkout stays literally true.
const BASES = Object.freeze({
  web: 5173, // core/demo Vite web server (vite.config.ts, strictPort)
  dbWeb: 5273, // db-backed E2E web server (dev:api)
  authWeb: 5373, // auth-backed E2E web server (dev:auth)
  dbApi: 8787, // SQLite API, dev full-stack and db-backed E2E
  authApi: 8887, // password-mode API for the auth-backed E2E flavour
  preview: 4173, // `vite preview` and scripts/serve-dist.mjs
  docsDev: 5900, // VitePress dev, pinned to avoid its default port 5173
  docsPreview: 5910, // VitePress preview, pinned to avoid its default port 4173
});

// The local access lab keeps a fixed, exclusive pair of ports outside the lane system.
export const ACCESS_LAB_FIXED_PORTS = Object.freeze({ web: 5473, api: 8897 });

export const FIXED_PORTS_LOCK_FILE = "server/.fixed-ports.lock";

/** Return an integer lane from 0 to `LANE_CEILING - 1`, or throw `RangeError`. */
export function assertLane(lane) {
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_CEILING) {
    throw new RangeError(
      `A port lane must be an integer from 0 to ${LANE_CEILING - 1}; received ${JSON.stringify(lane)}.`,
    );
  }
  return lane;
}

/** Map a valid lane to frozen service ports; invalid lanes throw `RangeError`. */
export function portsForLane(lane) {
  assertLane(lane);
  return Object.freeze(Object.fromEntries(Object.entries(BASES).map(([service, base]) => [service, base + lane])));
}

/**
 * The lane this process is running in. Reads the environment only. A process that has not been
 * launched through scripts/with-lane.mjs is lane 0, which is exactly the historical behaviour.
 * Invalid non-empty values throw `RangeError`.
 */
export function resolveLane(environment = process.env) {
  const raw = environment[LANE_ENVIRONMENT_KEY];
  if (raw === undefined || raw === "") return 0;
  const lane = Number(raw);
  if (!Number.isInteger(lane)) {
    throw new RangeError(
      `${LANE_ENVIRONMENT_KEY} must be an integer from 0 to ${LANE_CEILING - 1}; received ${JSON.stringify(raw)}.`,
    );
  }
  return assertLane(lane);
}

/** Return this process's lane-derived ports; invalid lane values throw `RangeError`. */
export function ports(environment = process.env) {
  return portsForLane(resolveLane(environment));
}

/**
 * A run's own CPU reservation: how many test workers it may start. scripts/laneClaims.mjs reserves
 * this from a machine-wide pool and exports it. A suite run by hand, outside a lane, gets the same
 * ceiling a solo claim would receive, half the available cores (see reservationCeiling).
 * An invalid configured value throws `RangeError`.
 */
export function testShare(environment = process.env) {
  const raw = environment[SHARE_ENVIRONMENT_KEY];
  if (raw === undefined || raw === "") return reservationCeiling();
  const share = Number(raw);
  if (!Number.isInteger(share) || share < 1) {
    throw new RangeError(`${SHARE_ENVIRONMENT_KEY} must be a positive integer; received ${JSON.stringify(raw)}.`);
  }
  return share;
}

/** The size of the machine-wide pool the allocator hands out, leaving one core for everything else. */
export function soloShare(cores = availableParallelism()) {
  return Math.max(1, cores - 1);
}

/**
 * Caps one run at half the machine's parallelism, rounded up and never below one worker.
 *
 * Admission does not wait for capacity: when the pool is exhausted, a new run still receives one
 * worker. Limiting larger claims leaves CPU capacity for the application processes each worker
 * drives and reduces scheduling timeouts from oversubscription.
 */
export function reservationCeiling(cores = availableParallelism()) {
  return Math.max(1, Math.ceil(cores / 2));
}
