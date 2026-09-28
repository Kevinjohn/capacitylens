// Report what is holding the port lanes, and optionally stop leftovers:
//
//   pnpm run lanes                  list every lane port in use, its pid, directory and owner
//   pnpm run lanes --stop-orphans   also stop listeners from this repository's worktrees that no
//                                   live run has claimed
//
// with-lane.mjs never kills anything, so a server left behind by a hard-killed run (or one started
// outside the launcher) stays up until someone stops it. This is the deliberate way to find them.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { portInUse } from "./devProcesses.mjs";
import { laneDirectory, listenerDirectory, listenerPid, readLiveClaims } from "./laneClaims.mjs";
import { LANE_CEILING, portsForLane } from "./ports.mjs";

/** Every worktree path of the repository this script belongs to. */
export function repositoryWorktrees(run = execFileSync) {
  const output = String(run("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" }));
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

// lsof reports a process's resolved directory, so compare resolved paths on both sides.
function canonical(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return resolve(path);
    throw error;
  }
}

function insideAny(directory, roots) {
  if (directory === null) return false;
  const path = canonical(directory);
  return roots.some((root) => path === root || path.startsWith(root + sep));
}

/**
 * One row per occupied lane port. `orphan` is true only for a listener running from one of this
 * repository's worktrees on a lane that no live run has claimed; anything else is reported, never
 * a candidate for stopping.
 */
export async function surveyLanes({
  environment = process.env,
  worktrees = repositoryWorktrees(),
  probe = portInUse,
  owner = listenerPid,
  directoryOf = listenerDirectory,
} = {}) {
  const roots = worktrees.map(canonical);
  const listeners = [];
  for (let lane = 0; lane < LANE_CEILING; lane += 1) {
    for (const [service, port] of Object.entries(portsForLane(lane))) {
      if (!(await probe(port))) continue;
      const pid = owner(port);
      listeners.push({ lane, service, port, pid, directory: pid === null ? null : directoryOf(pid) });
    }
  }
  // Read claims only after the scan: a launcher writes its claim before its server listens, so a run
  // that started during the scan is already claimed here and never mistaken for a leftover.
  const claims = readLiveClaims(laneDirectory(environment));
  return listeners.map((listener) => {
    const claim = claims.get(listener.lane) ?? null;
    const orphan = listener.pid !== null && claim === null && insideAny(listener.directory, roots);
    return { ...listener, claim, orphan };
  });
}

/**
 * The pids safe to stop: a process is stopped only when every lane port it holds is a leftover, so
 * a process that also serves a claimed lane is never touched. Each pid appears once.
 */
export function leftoverPids(rows) {
  const eligible = new Map();
  for (const row of rows) {
    if (row.pid === null) continue;
    eligible.set(row.pid, (eligible.get(row.pid) ?? true) && row.orphan);
  }
  return [...eligible].filter(([, leftover]) => leftover).map(([pid]) => pid);
}

function describe(row) {
  const who =
    row.pid === null ? "an unidentified process" : `pid ${row.pid} in ${row.directory ?? "an unknown directory"}`;
  const owner = row.claim
    ? `claimed by pid ${row.claim.pid} (${row.claim.worktree})`
    : row.orphan
      ? "no live run — leftover from this repository"
      : "no live run — not from this repository";
  return `lane ${row.lane} ${row.service} :${row.port}  ${who}  ${owner}`;
}

async function main() {
  const stopOrphans = process.argv.includes("--stop-orphans");
  const rows = await surveyLanes();
  if (rows.length === 0) {
    console.log("No lane ports are in use.");
    return;
  }
  for (const row of rows) console.log(describe(row));
  const orphans = leftoverPids(rows);
  if (!stopOrphans) {
    if (orphans.length > 0)
      console.log(`\n${orphans.length} leftover process(es). Stop them with: pnpm run lanes --stop-orphans`);
    return;
  }
  let failed = false;
  for (const pid of orphans) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Stopped pid ${pid}.`);
    } catch (error) {
      failed = true;
      console.error(`Could not stop pid ${pid}: ${error.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main();
