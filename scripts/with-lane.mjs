// Run a command inside a claimed port lane and CPU reservation:
//
//   node scripts/with-lane.mjs playwright test
//
// The claim happens HERE, before the child starts, because the alternative does not work: a
// Playwright globalSetup runs after playwright.config.ts has already materialised its ports, and
// `pnpm run gate` has no setup hook at all. Claiming in the launcher means every configuration file
// only has to read CAPACITYLENS_PORT_LANE, which is already fixed by the time it is evaluated.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { claimLane, reapLane } from "./lane-claim.mjs";
import { LANE_ENVIRONMENT_KEY, SHARE_ENVIRONMENT_KEY, portsForLane, resolveLane, testShare } from "./ports.mjs";

const worktree = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("with-lane: expected a command to run, for example `node scripts/with-lane.mjs playwright test`.");
  process.exit(2);
}

// An inherited lane belongs to an outer launcher, which will also release it. Nesting must not
// claim a second lane, and must never release a lane it did not take.
const inherited = process.env[LANE_ENVIRONMENT_KEY] !== undefined && process.env[LANE_ENVIRONMENT_KEY] !== "";
const claim = inherited ? { lane: resolveLane(), share: testShare(), release: () => false } : claimLane({ worktree });

let released = false;
function release() {
  if (released) return;
  released = true;
  try {
    claim.release();
  } catch (error) {
    console.error(`with-lane: releasing lane ${claim.lane} failed: ${error.message}`);
  }
}

try {
  if (!inherited) {
    const reaped = await reapLane(claim.lane, worktree);
    for (const { port, pid } of reaped)
      console.error(`with-lane: cleared an orphan from this worktree on port ${port} (pid ${pid}).`);
  }
} catch (error) {
  release();
  console.error(error.message);
  process.exit(1);
}

const lanePorts = portsForLane(claim.lane);
if (!inherited) {
  console.error(
    `with-lane: lane ${claim.lane} — web ${lanePorts.web}, api ${lanePorts.dbApi}, ${claim.share} test worker${claim.share === 1 ? "" : "s"}.`,
  );
}

const child = spawn(command, args, {
  stdio: "inherit",
  env: { ...process.env, [LANE_ENVIRONMENT_KEY]: String(claim.lane), [SHARE_ENVIRONMENT_KEY]: String(claim.share) },
});

// Forward the interactive signals rather than dying first: the child owns servers whose own
// shutdown frees the lane's ports, and killing the launcher before them is how orphans are made.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
process.on("exit", release);

child.on("error", (error) => {
  release();
  console.error(`with-lane: could not start ${command}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  release();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
