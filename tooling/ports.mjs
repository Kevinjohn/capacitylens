// Each long-running local server uses a port-lane-derived port. A port lane is an integer from 0–9, and each
// port is `base + port lane`, so ten concurrent worktrees do not overlap. Port lane 0 preserves the ports
// used by CI, documentation, and a single checkout.
//
// This module is pure: it maps a port lane to ports and reads already-resolved environment values.
// Claiming a port lane (and the CPU reservation that rides with it) lives in scripts/dev/laneClaims.mjs,
// and scripts/dev/with-lane.mjs is the launcher that owns both for the lifetime of a command.
// Configurations only read the selected port lane; the launcher owns its claim.
import { availableParallelism } from 'node:os';

// Ten port lanes, deliberately. The auth API base is spaced from other port lane bases so each
// checkout receives a disjoint service set.
/** Number of disjoint service-port lanes available to concurrent runs. */
export const PORT_LANE_CEILING = 10;

/** The launcher-selected port lane key, read before configuration evaluation because global setup occurs too late to claim a port lane. */
export const PORT_LANE_ENVIRONMENT_KEY = 'CAPACITYLENS_PORT_LANE';
/** Environment key identifying the outer launcher’s claim so nested launchers do not release it. */
export const PORT_LANE_CLAIM_ENVIRONMENT_KEY = 'CAPACITYLENS_PORT_LANE_CLAIM';
/** Environment key containing the run’s reserved worker share. */
export const SHARE_ENVIRONMENT_KEY = 'CAPACITYLENS_TEST_SHARE';

// Port lane 0 preserves the documented and CI endpoints.
const BASES = Object.freeze({
  web: 5173,
  dbWeb: 5273,
  authWeb: 5373,
  dbApi: 8787,
  authApi: 8887,
  testHttp: 8987,
  preview: 4173,
  docsDev: 5900,
  docsPreview: 5910,
});

/** First API port in the isolated browser-worker range. */
export const WORKER_BASE = 10000;
/** Number of worker API ports reserved per port lane. */
export const WORKER_SLOTS_PER_PORT_LANE = 50;

/** Return the isolated API port for a port lane and stable parallel-worker slot. */
export function workerPorts(portLane, slot) {
  assertPortLane(portLane);
  if (!Number.isInteger(slot) || slot < 0 || slot >= WORKER_SLOTS_PER_PORT_LANE) {
    throw new RangeError(
      `A worker slot must be an integer from 0 to ${WORKER_SLOTS_PER_PORT_LANE - 1}; received ${JSON.stringify(slot)}.`,
    );
  }
  return Object.freeze({ api: WORKER_BASE + portLane * WORKER_SLOTS_PER_PORT_LANE + slot });
}

/** Return an integer port lane from 0 to `PORT_LANE_CEILING - 1`, or throw `RangeError`. */
export function assertPortLane(portLane) {
  if (!Number.isInteger(portLane) || portLane < 0 || portLane >= PORT_LANE_CEILING) {
    throw new RangeError(
      `A port lane must be an integer from 0 to ${PORT_LANE_CEILING - 1}; received ${JSON.stringify(portLane)}.`,
    );
  }
  return portLane;
}

/** Map a valid port lane to frozen service ports; invalid port lanes throw `RangeError`. */
export function portsForPortLane(portLane) {
  assertPortLane(portLane);
  return Object.freeze(
    Object.fromEntries(Object.entries(BASES).map(([service, base]) => [service, base + portLane])),
  );
}

/**
 * Reads the selected port lane without claiming it, defaulting unset or empty input to port lane 0.
 * @throws RangeError when a configured port lane is invalid.
 */
export function resolvePortLane(environment = process.env) {
  const raw = environment[PORT_LANE_ENVIRONMENT_KEY];
  if (raw === undefined || raw === '') return 0;
  const portLane = Number(raw);
  if (!Number.isInteger(portLane)) {
    throw new RangeError(
      `${PORT_LANE_ENVIRONMENT_KEY} must be an integer from 0 to ${PORT_LANE_CEILING - 1}; received ${JSON.stringify(raw)}.`,
    );
  }
  return assertPortLane(portLane);
}

/** Return this process's port-lane-derived ports; invalid port lane values throw `RangeError`. */
export function ports(environment = process.env) {
  return portsForPortLane(resolvePortLane(environment));
}

/**
 * A run's own CPU reservation: how many test workers it may start. scripts/dev/laneClaims.mjs reserves
 * this from a machine-wide pool and exports it. A suite run by hand, outside a port lane, gets the same
 * ceiling a solo claim would receive, half the available cores (see reservationCeiling).
 * An invalid configured value throws `RangeError`.
 */
export function testShare(environment = process.env) {
  const raw = environment[SHARE_ENVIRONMENT_KEY];
  if (raw === undefined || raw === '') return reservationCeiling();
  const share = Number(raw);
  if (!Number.isInteger(share) || share < 1) {
    throw new RangeError(
      `${SHARE_ENVIRONMENT_KEY} must be a positive integer; received ${JSON.stringify(raw)}.`,
    );
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
