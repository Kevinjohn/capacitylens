// Claiming a port lane and a share of the machine's CPUs. scripts/ports.mjs maps a lane to ports
// and is pure; everything that touches the filesystem or another process lives here, and
// scripts/with-lane.mjs is the only caller in normal use.
//
// Two invariants this file exists to hold:
//   1. Two runs never hold the same lane. Scanning for a free lane and writing the claim happen
//      under a directory mutex, so two starters cannot both decide the same stale lane is theirs.
//   2. A release never deletes someone else's claim. Release re-reads the file and unlinks only
//      when the recorded pid is still ours — otherwise a slow releaser would delete the lock a
//      successor had just created.
import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, readdirSync, readFileSync, closeSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { LANE_CEILING, portsForLane, reservationCeiling, soloShare } from "./ports.mjs";
import { portInUse } from "./dev-processes.mjs";

const MUTEX_STALE_MS = 30_000;

export function laneDirectory(environment = process.env) {
  const cacheHome = environment.XDG_CACHE_HOME || join(environment.HOME || homedir(), ".cache");
  return join(cacheHome, "capacitylens", "lanes");
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user, which still makes the lane taken.
    return error.code === "EPERM";
  }
}

function readClaim(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    // A truncated or unparseable claim is treated as abandoned: a run died mid-write.
    return { pid: 0, corrupt: true };
  }
}

/**
 * Hold the directory mutex for the duration of `body`. Kept to the scan-and-write window only —
 * milliseconds — so a crashed holder blocks nobody for long, and a mutex older than MUTEX_STALE_MS
 * whose pid is gone is broken open.
 */
function withMutex(directory, body) {
  const path = join(directory, ".mutex");
  const deadline = Date.now() + MUTEX_STALE_MS;
  for (;;) {
    let descriptor;
    try {
      descriptor = openSync(path, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const holder = readClaim(path);
      const expired =
        !holder || holder.corrupt || !processAlive(holder.pid) || Date.now() - (holder.at ?? 0) > MUTEX_STALE_MS;
      if (expired) {
        removeQuietly(path);
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`lane: the claim mutex at ${path} is held by pid ${holder.pid} and did not clear.`, {
          cause: error,
        });
      }
      // Busy-wait rather than sleep: the window being guarded is a few file writes long.
      continue;
    }
    try {
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, at: Date.now() }));
      return body();
    } finally {
      closeSync(descriptor);
      // Never throw out of this finally: it would replace whatever the guarded body was reporting
      // with a filesystem detail. A mutex that cannot be removed is reported and then expires.
      removeQuietly(path);
    }
  }
}

/** Remove a lock file, tolerating one that a racing reclaimer has already taken away. */
function removeQuietly(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    console.error(`lane: could not remove ${path}: ${error.message}`);
  }
}

function claimPath(directory, lane) {
  return join(directory, `${lane}.json`);
}

/** Live claims only; a claim whose pid has gone is deleted as it is found. */
function liveClaims(directory) {
  const claims = new Map();
  for (const name of readdirSync(directory)) {
    const match = /^(\d+)\.json$/.exec(name);
    if (!match) continue;
    const lane = Number(match[1]);
    const path = join(directory, name);
    const claim = readClaim(path);
    if (claim && !claim.corrupt && processAlive(claim.pid)) {
      claims.set(lane, claim);
      continue;
    }
    removeQuietly(path);
  }
  return claims;
}

/**
 * The reservation for a new run: what the pool has left, capped so that one early run cannot take
 * so much that the latecomers' floor pushes the machine far past its core count, and floored at one
 * because admission never blocks.
 */
export function shareForClaims(claims, cores) {
  const reserved = [...claims.values()].reduce((total, claim) => total + (claim.share ?? 1), 0);
  return Math.max(1, Math.min(soloShare(cores), reservationCeiling(cores), soloShare(cores) - reserved));
}

/** The pid listening on a port, or null. Unix-only; the repository's supported development host. */
export function listenerPid(port, run = execFileSync) {
  try {
    const output = String(run("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { stdio: ["ignore", "pipe", "ignore"] }));
    const pid = Number(output.trim().split(/\s+/)[0]);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    // A non-zero exit means nothing is listening; lsof reports no match that way.
    return null;
  }
}

/** A listener's working directory, used to decide whether an orphan on our lane is ours to kill. */
function listenerDirectory(pid, run = execFileSync) {
  try {
    const output = String(
      run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { stdio: ["ignore", "pipe", "ignore"] }),
    );
    const line = output.split("\n").find((entry) => entry.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

/**
 * Clear orphans left on a freshly claimed lane by an earlier run in this worktree — a hard kill can
 * leave a detached Vite or API server holding a port after the pid that started it is gone, and the
 * next run then fails for a reason that has nothing to do with its change.
 *
 * Occupancy is not ownership. A listener is killed only when it is running from this worktree; a
 * stranger's process on one of our ports is reported and the lane refused, never killed.
 */
export async function reapLane(
  lane,
  worktree,
  { probe = portInUse, owner = listenerPid, directoryOf = listenerDirectory, kill = process.kill } = {},
) {
  const reaped = [];
  for (const [service, port] of Object.entries(portsForLane(lane))) {
    if (!(await probe(port))) continue;
    const pid = owner(port);
    if (pid === null)
      throw new Error(
        `lane ${lane}: port ${port} (${service}) is held by a process lsof cannot identify. Free it before retrying.`,
      );
    const directory = directoryOf(pid);
    if (directory === null || resolve(directory) !== resolve(worktree)) {
      throw new Error(
        `lane ${lane}: port ${port} (${service}) is held by pid ${pid} running in ${directory ?? "an unknown directory"}, not this worktree. ` +
          `Refusing to kill another checkout's process — stop it, or run with ${"CAPACITYLENS_PORT_LANE"} set to a free lane.`,
      );
    }
    kill(pid, "SIGKILL");
    reaped.push({ port, pid });
  }
  return reaped;
}

/**
 * Claim the lowest free lane plus a CPU share. Returns the lane, the share, and a release that is
 * safe to call more than once.
 */
export function claimLane({ worktree, environment = process.env, cores } = {}) {
  const directory = laneDirectory(environment);
  mkdirSync(directory, { recursive: true });
  return withMutex(directory, () => {
    const claims = liveClaims(directory);
    const lane = [...Array(LANE_CEILING).keys()].find((candidate) => !claims.has(candidate));
    if (lane === undefined) {
      const holders = [...claims.entries()]
        .map(([held, claim]) => `  lane ${held}: pid ${claim.pid} in ${claim.worktree}`)
        .join("\n");
      throw new Error(
        `All ${LANE_CEILING} port lanes are held:\n${holders}\nWait for one to finish, or stop one of those runs.`,
      );
    }
    const share = shareForClaims(claims, cores);
    const path = claimPath(directory, lane);
    const descriptor = openSync(path, "wx", 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, worktree, share, at: Date.now() }, null, 2));
    } finally {
      closeSync(descriptor);
    }
    return { lane, share, release: () => releaseLane(directory, lane) };
  });
}

/** Release a lane, but only if it is still ours — see invariant 2 at the top of this file. */
export function releaseLane(directory, lane) {
  const path = claimPath(directory, lane);
  const claim = readClaim(path);
  if (!claim || claim.pid !== process.pid) return false;
  removeQuietly(path);
  return true;
}
