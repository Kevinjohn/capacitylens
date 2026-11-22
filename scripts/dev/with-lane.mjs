// Run a command inside a claimed port lane and CPU reservation:
//
//   node scripts/dev/with-lane.mjs playwright test
//
// Claim before starting the child because configuration files resolve ports before global setup can run.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSupportedNodeVersion } from '../../apps/backend/start/node_version.ts';
import { mirrorChildExit } from '../../tooling/devProcesses.mjs';
import { assertPortLaneFree, resolveLaunchClaim } from './laneClaims.mjs';
import {
  PORT_LANE_CLAIM_ENVIRONMENT_KEY,
  PORT_LANE_ENVIRONMENT_KEY,
  SHARE_ENVIRONMENT_KEY,
  portsForPortLane,
} from '../../tooling/ports.mjs';

// Refuse an unsupported runtime before a port lane is claimed, so nothing is left to release.
try {
  assertSupportedNodeVersion();
} catch (error) {
  console.error(`with-lane: ${error.message}`);
  process.exit(1);
}

const worktree = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error(
    'with-lane: expected a command to run, for example `node scripts/dev/with-lane.mjs playwright test`.',
  );
  process.exit(2);
}

// An inherited port lane belongs to an outer launcher, which also releases it; a hand-selected port lane is
// reserved and released here like an automatic one.
const claim = resolveLaunchClaim({ worktree });
const { inherited } = claim;

let released = false;
function release() {
  if (released) return;
  released = true;
  try {
    claim.release();
  } catch (error) {
    // Report release failure without replacing the child’s result; a later claim can inspect and reclaim the stale reservation.
    console.error(`with-lane: releasing port lane ${claim.portLane} failed: ${error.message}`);
  }
}

try {
  if (!inherited) {
    await assertPortLaneFree(claim.portLane);
  }
} catch (error) {
  // Release our reservation and surface occupied-port failures before starting a child.
  release();
  console.error(error.message);
  process.exit(1);
}

const portLanePorts = portsForPortLane(claim.portLane);
if (!inherited) {
  console.error(
    `with-lane: port lane ${claim.portLane} — web ${portLanePorts.web}, api ${portLanePorts.dbApi}, ${claim.share} test worker${claim.share === 1 ? '' : 's'}.`,
  );
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    [PORT_LANE_ENVIRONMENT_KEY]: String(claim.portLane),
    [PORT_LANE_CLAIM_ENVIRONMENT_KEY]: claim.token,
    [SHARE_ENVIRONMENT_KEY]: String(claim.share),
  },
});

process.on('exit', release);
mirrorChildExit(child, { label: `with-lane: ${command}`, release });
