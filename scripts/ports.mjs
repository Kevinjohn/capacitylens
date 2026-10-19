// Each long-running local server uses a lane-derived port. A lane is an integer from 0–9, and each
// port is `base + lane`, so ten concurrent worktrees do not overlap. Lane 0 preserves the ports
// used by CI, documentation, and a single checkout.
//
// This module is pure: it maps a lane to ports and reads already-resolved environment values.
// Claiming a lane (and the CPU reservation that rides with it) lives in scripts/laneClaims.mjs,
// and scripts/with-lane.mjs is the launcher that owns both for the lifetime of a command.
// Configurations only read the selected lane; the launcher owns its claim.
import { availableParallelism } from "node:os";

// Ten lanes, deliberately. The auth API base is spaced from other lane bases so each
// checkout receives a disjoint service set.
/** Number of disjoint service-port lanes available to concurrent runs. */
export const LANE_CEILING = 10;

/** The launcher-selected lane key, read before configuration evaluation because global setup occurs too late to claim a lane. */
export const LANE_ENVIRONMENT_KEY = "CAPACITYLENS_PORT_LANE";
/** Environment key identifying the outer launcher’s claim so nested launchers do not release it. */
export const LANE_CLAIM_ENVIRONMENT_KEY = "CAPACITYLENS_LANE_CLAIM";
/** Environment key containing the run’s reserved worker share. */
export const SHARE_ENVIRONMENT_KEY = "CAPACITYLENS_TEST_SHARE";

// Lane 0 preserves the documented and CI endpoints.
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
 * Reads the selected lane without claiming it, defaulting unset or empty input to lane 0.
 * @throws RangeError when a configured lane is invalid.
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
