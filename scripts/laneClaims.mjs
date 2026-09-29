// Claiming a port lane and a share of the machine's CPUs. scripts/ports.mjs maps a lane to ports
// and is pure; everything that touches the filesystem or another process lives here, and
// scripts/with-lane.mjs is the only caller in normal use.
//
// Two invariants this file exists to hold:
//   1. Two runs never hold the same lane. Scanning for a free lane and writing the claim happen
//      under a directory mutex, so two starters cannot both decide the same stale lane is theirs.
//   2. A release never deletes someone else's claim. Release re-reads the file and unlinks only
//      when the recorded token is still ours — otherwise a slow releaser would delete the lock a
//      successor had just created.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  closeSync,
  unlinkSync,
  writeFileSync,
  renameSync,
  rmdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  LANE_CEILING,
  LANE_CLAIM_ENVIRONMENT_KEY,
  LANE_ENVIRONMENT_KEY,
  portsForLane,
  reservationCeiling,
  resolveLane,
  soloShare,
  testShare,
} from "./ports.mjs";
import { portInUse } from "./devProcesses.mjs";

const MUTEX_STALE_MS = 30_000;
// A legacy publisher wrote its owner microseconds after creating the file.
const LEGACY_PUBLISH_GRACE_MS = 5_000;
const MUTEX_WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));
let claimSequence = 0;

export function laneDirectory(environment = process.env) {
  const cacheHome = environment.XDG_CACHE_HOME || join(environment.HOME || homedir(), ".cache");
  return join(cacheHome, "capacitylens", "lanes");
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user, which still makes the lane taken.
    return error.code === "EPERM";
  }
}

function readClaim(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    // Any other read failure says nothing about the holder, so reaping the lane would break
    // invariant 1.
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    // A truncated or unparseable claim is treated as abandoned: a run died mid-write.
    return { pid: 0, corrupt: true };
  }
}

/**
 * Hold the directory mutex for the duration of `body`. Kept to the scan-and-write window only —
 * milliseconds — a dead holder can be reaped, while a live holder is never reaped based on age.
 * MUTEX_STALE_MS only limits how long a contender waits for a live holder.
 */
function withMutex(directory, body) {
  const path = join(directory, ".mutex");
  const deadline = Date.now() + MUTEX_STALE_MS;
  for (;;) {
    const ownerName = `owner-${process.pid}-${Date.now()}-${++claimSequence}.json`;
    const temporary = join(directory, `.mutex-${ownerName}`);
    mkdirSync(temporary, { mode: 0o700 });
    writeFileSync(join(temporary, ownerName), JSON.stringify({ pid: process.pid, at: Date.now() }), {
      flag: "wx",
      mode: 0o600,
    });
    try {
      // A populated directory cannot replace another populated directory. Publish only after
      // its owner file is complete, so contenders never observe a half-written owner.
      renameSync(temporary, path);
    } catch (error) {
      releaseMutex(temporary, ownerName);
      if (!["EEXIST", "ENOTEMPTY", "EISDIR", "ENOTDIR"].includes(error.code)) throw error;
      const holder = readMutexOwner(path);
      // The old file format published the path before writing its owner. An empty/corrupt legacy
      // file may belong to a live publisher paused in that window, so it is reaped only once it
      // is older than any such pause could be.
      if (holder?.legacy && (holder.corrupt || !Number.isInteger(holder.pid) || holder.pid <= 0)) {
        if (legacyMutexAbandoned(path)) {
          removeLegacyMutex(path);
          continue;
        }
        if (Date.now() > deadline)
          throw new Error(`lane: the legacy claim mutex at ${path} has no valid owner.`, { cause: error });
        Atomics.wait(MUTEX_WAIT_ARRAY, 0, 0, 10);
        continue;
      }
      if (holder && !processAlive(holder.pid)) {
        if (holder.legacy) {
          removeLegacyMutex(path);
          continue;
        }
        // A second reaper can remove only this dead owner's unique file. A successor's different
        // owner file keeps its directory nonempty, so rmdir cannot remove the successor's lock.
        releaseMutex(path, holder.name);
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `lane: the claim mutex at ${path} is held by pid ${holder?.pid ?? "unknown"} and did not clear.`,
          {
            cause: error,
          },
        );
      }
      // Pause briefly between attempts so mutex contention does not spin at full CPU.
      Atomics.wait(MUTEX_WAIT_ARRAY, 0, 0, 10);
      continue;
    }
    try {
      return body();
    } finally {
      releaseMutex(path, ownerName);
    }
  }
}

function legacyMutexAbandoned(path) {
  try {
    return Date.now() - statSync(path).mtimeMs > LEGACY_PUBLISH_GRACE_MS;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// Older launchers used a regular file. Unlink cannot delete a directory successor.
function removeLegacyMutex(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!["ENOENT", "EISDIR", "EPERM"].includes(error.code)) throw error;
  }
}

function readMutexOwner(path) {
  try {
    const [name] = readdirSync(path);
    if (!name) return null;
    const claim = readClaim(join(path, name));
    return claim ? { ...claim, name } : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ENOTDIR") {
      const claim = readClaim(path);
      return claim ? { ...claim, legacy: true } : null;
    }
    throw error;
  }
}

export function releaseMutex(path, ownerName) {
  removeQuietly(join(path, ownerName));
  try {
    rmdirSync(path);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY")
      console.error(`lane: could not remove ${path}: ${error.message}`);
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

/**
 * Live claims by lane, read without the mutex and without deleting anything, so a report can never
 * remove a claim that a concurrent starter is still writing.
 */
export function readLiveClaims(directory) {
  const claims = new Map();
  let names;
  try {
    names = readdirSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return claims;
    throw error;
  }
  for (const name of names) {
    const match = /^(\d+)\.json$/.exec(name);
    if (!match) continue;
    const claim = readClaim(join(directory, name));
    if (claim && !claim.corrupt && processAlive(claim.pid)) claims.set(Number(match[1]), claim);
  }
  return claims;
}

/** Live claims only; a claim whose pid has gone is deleted as it is found. */
function collectLiveClaimsAndPruneStaleFiles(directory) {
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
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("lane: lsof is required to inspect an occupied lane port; install lsof and retry.", {
        cause: error,
      });
    // A non-zero exit means nothing is listening; lsof reports no match that way.
    return null;
  }
}

/** A listener's working directory, included when reporting an occupied lane. */
export function listenerDirectory(pid, run = execFileSync) {
  try {
    const output = String(
      run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { stdio: ["ignore", "pipe", "ignore"] }),
    );
    const line = output.split("\n").find((entry) => entry.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("lane: lsof is required to inspect an occupied lane port; install lsof and retry.", {
        cause: error,
      });
    return null;
  }
}

/**
 * Refuse a freshly claimed lane when any of its ports are occupied. Occupancy is not ownership, so
 * the launcher reports the listener and leaves stopping it to the developer.
 */
export async function assertLaneFree(
  lane,
  { probe = portInUse, owner = listenerPid, directoryOf = listenerDirectory } = {},
) {
  for (const [service, port] of Object.entries(portsForLane(lane))) {
    if (!(await probe(port))) continue;
    const pid = owner(port);
    if (pid === null)
      throw new Error(
        `lane ${lane}: port ${port} (${service}) is held by a process lsof cannot identify. Free it before retrying.`,
      );
    const directory = directoryOf(pid);
    throw new Error(
      `lane ${lane}: port ${port} (${service}) is held by pid ${pid} running in ${directory ?? "an unknown directory"}. ` +
        `Stop it with kill ${pid}, or choose another lane with CAPACITYLENS_PORT_LANE=<n>.`,
    );
  }
}

/**
 * Claim a selected lane, or the lowest free lane, plus a CPU share. Returns the lane, share, claim
 * token, and a release that is safe to call more than once.
 */
export function claimLane({ worktree, environment = process.env, cores, lane: requestedLane } = {}) {
  const directory = laneDirectory(environment);
  mkdirSync(directory, { recursive: true });
  return withMutex(directory, () => {
    const claims = collectLiveClaimsAndPruneStaleFiles(directory);
    const heldClaim = requestedLane === undefined ? undefined : claims.get(requestedLane);
    if (heldClaim) throw new Error(`lane ${requestedLane} is held by pid ${heldClaim.pid} in ${heldClaim.worktree}`);
    const lane = requestedLane ?? [...Array(LANE_CEILING).keys()].find((candidate) => !claims.has(candidate));
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
    const token = `${process.pid}-${Date.now()}-${++claimSequence}`;
    const descriptor = openSync(path, "wx", 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, worktree, share, token }, null, 2));
    } finally {
      closeSync(descriptor);
    }
    return { lane, share, token, release: () => releaseLane(directory, lane, token) };
  });
}

/** Release a lane, but only if it is still ours — see invariant 2 at the top of this file. */
export function releaseLane(directory, lane, token) {
  const path = claimPath(directory, lane);
  const claim = readClaim(path);
  if (!claim || claim.pid !== process.pid || claim.token !== token) return false;
  removeQuietly(path);
  return true;
}

/**
 * The lane a launch runs in. A lane is inherited only when an outer launcher supplied both its lane
 * and claim marker; that claim is never released here. Otherwise this launch claims its own lane —
 * the one selected by hand when the lane variable is set, else the lowest free one.
 */
export function resolveLaunchClaim({ worktree, environment = process.env, claim = claimLane } = {}) {
  const selected = Boolean(environment[LANE_ENVIRONMENT_KEY]);
  if (selected && environment[LANE_CLAIM_ENVIRONMENT_KEY]) {
    return {
      inherited: true,
      lane: resolveLane(environment),
      share: testShare(environment),
      token: environment[LANE_CLAIM_ENVIRONMENT_KEY],
      release: () => false,
    };
  }
  const claimed = claim({ worktree, environment, ...(selected ? { lane: resolveLane(environment) } : {}) });
  return { inherited: false, ...claimed };
}
