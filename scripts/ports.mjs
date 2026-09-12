// Every long-running local server in this repository used to bind a hardcoded port, which is
// correct for one checkout and unworkable for several: a second `pnpm run e2e` could not start,
// and a crashed run left orphans that failed the next one for an unrelated reason. A LANE is one
// integer 0-9 held by one run; every port is `base + lane`, so ten concurrent worktrees never
// overlap. Lane 0 reproduces every port this repository used before lanes existed, so CI, the
// documentation and a single checkout are unaffected.
//
// This module is PURE: it maps a lane to ports and reads already-resolved environment values.
// Claiming a lane (and the CPU reservation that rides with it) lives in scripts/lane-claim.mjs,
// and scripts/with-lane.mjs is the launcher that owns both for the lifetime of a command.
// Configuration files must only ever READ: see the note on LANE_ENVIRONMENT_KEY below.
import { availableParallelism } from "node:os";

// Ten lanes, deliberately. The bases below are spaced 100 apart except the auth/OIDC API pair
// (8887/8897), which is spaced 10 — so a ceiling above 10 would make lane 10's auth API collide
// with the OIDC API. Move 8897 before raising this.
export const LANE_CEILING = 10;

// Set by scripts/with-lane.mjs on the child environment; read by every config and helper. A config
// file that tried to CLAIM a lane instead of reading this would claim too late to matter:
// playwright.config.ts has already materialised its ports by the time its globalSetup runs.
export const LANE_ENVIRONMENT_KEY = "CAPACITYLENS_PORT_LANE";
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
  docsDev: 5900, // VitePress dev — pinned OFF 5173, which it would otherwise default to
  docsPreview: 5910, // VitePress preview — pinned OFF 4173, which it would otherwise default to
});

// The OIDC flavour is deliberately absent. e2e/oidc/dex.yaml pins the issuer to 127.0.0.1:5556 and
// the callback to localhost:5473, and scripts/e2e-oidc.mjs maps that host port fixedly in a
// container; moving them is Docker work. `pnpm run e2e:oidc` therefore stays single-flight
// machine-wide on its historical ports and is excluded from the ten-lane guarantee.
export const OIDC_FIXED_PORTS = Object.freeze({ oidcWeb: 5473, oidcApi: 8897, dex: 5556, dexFaultProxy: 5557 });

// `pnpm run e2e:oidc` and `pnpm run dev:access` both bind the ports above, so they have to exclude
// each other as well as a second run of themselves. One lock file, held by whichever starts first.
export const FIXED_PORTS_LOCK_FILE = "server/.fixed-ports.lock";

export function assertLane(lane) {
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_CEILING) {
    throw new RangeError(
      `A port lane must be an integer from 0 to ${LANE_CEILING - 1}; received ${JSON.stringify(lane)}.`,
    );
  }
  return lane;
}

/** Every lane-derived port for one lane, keyed by service. */
export function portsForLane(lane) {
  assertLane(lane);
  return Object.freeze(Object.fromEntries(Object.entries(BASES).map(([service, base]) => [service, base + lane])));
}

/**
 * The lane this process is running in. Reads the environment only — a process that has not been
 * launched through scripts/with-lane.mjs is lane 0, which is exactly the historical behaviour.
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

/** The lane-derived ports for this process. */
export function ports(environment = process.env) {
  return portsForLane(resolveLane(environment));
}

/**
 * A run's own CPU reservation: how many test workers it may start. scripts/lane-claim.mjs reserves
 * this from a machine-wide pool and exports it. A suite run by hand, outside a lane, gets the same
 * ceiling a solo claim would — half the cores, which is Playwright's own default and the point
 * where the app suite stops failing on timeouts (see reservationCeiling).
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
 * The most any single run may reserve. Admission never blocks, so the pool is a BOUND rather than a
 * hard cap: a run that arrives to an empty pool still gets one worker. Capping a single run at half
 * the cores keeps the worst case — one early large holder plus nine latecomers at the floor — near
 * the core count instead of nearly twice it.
 *
 * Half the cores is also where this suite is reliable. Measured on a 10-core machine: the app suite
 * at 9 workers finished 23% faster and failed two AuthProvider tests on a 5s timeout; at 5 workers
 * it passed. Those timeouts are assertions about scheduling, so oversubscription reads as a red
 * suite, and the investigation costs more than the 23%.
 */
export function reservationCeiling(cores = availableParallelism()) {
  return Math.max(1, Math.ceil(cores / 2));
}
