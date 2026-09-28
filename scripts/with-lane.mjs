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
import { mirrorChildExit } from "./devProcesses.mjs";
import { assertLaneFree, claimLane } from "./laneClaims.mjs";
import {
  LANE_CLAIM_ENVIRONMENT_KEY,
  LANE_ENVIRONMENT_KEY,
  SHARE_ENVIRONMENT_KEY,
  portsForLane,
  resolveLane,
  testShare,
} from "./ports.mjs";

const worktree = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("with-lane: expected a command to run, for example `node scripts/with-lane.mjs playwright test`.");
  process.exit(2);
}

// A lane is inherited only when an outer launcher supplied both its lane and claim marker. A lane
// selected by hand still needs its own reservation and release.
const inherited = Boolean(process.env[LANE_CLAIM_ENVIRONMENT_KEY]) && Boolean(process.env[LANE_ENVIRONMENT_KEY]);
const selectedLane = process.env[LANE_ENVIRONMENT_KEY] ? resolveLane() : undefined;
const claim = inherited
  ? { lane: resolveLane(), share: testShare(), token: process.env[LANE_CLAIM_ENVIRONMENT_KEY], release: () => false }
  : claimLane({ worktree, ...(selectedLane === undefined ? {} : { lane: selectedLane }) });

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
    await assertLaneFree(claim.lane);
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
  env: {
    ...process.env,
    [LANE_ENVIRONMENT_KEY]: String(claim.lane),
    [LANE_CLAIM_ENVIRONMENT_KEY]: claim.token,
    [SHARE_ENVIRONMENT_KEY]: String(claim.share),
  },
});

process.on("exit", release);
mirrorChildExit(child, { label: `with-lane: ${command}`, release });
