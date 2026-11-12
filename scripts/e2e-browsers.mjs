// Run real SQLite browser journeys on all three engines; Node24+ and the backend are required.
// Authentication journeys remain Chromium-only in e2e:all. Both invocations always run.

import {
  nonColourEnvironment,
  spawnPnpmSync,
  reportSpawnFailureAndResolveExitStatus,
} from './pnpmSpawn.mjs';
import { E2E_RUN_PRESETS, presetEnvironment } from './playwrightRunMode.mjs';

const forwardedArgs = process.argv.slice(2);

/** Run one Playwright invocation to completion; return its exit status (2 if it never started). */
function run(label, env, extraArgs = []) {
  console.log(`\n=== e2e:browsers — ${label} ===`);
  const res = spawnPnpmSync(['exec', 'playwright', 'test', ...extraArgs, ...forwardedArgs], {
    stdio: 'inherit',
    env: nonColourEnvironment({}, presetEnvironment(process.env, env)),
  });
  return reportSpawnFailureAndResolveExitStatus(`e2e:browsers ${label}`, res);
}

const chromeWebkit = run(
  'Chromium + WebKit/Safari',
  {
    CAPACITYLENS_E2E_PHASE: 'chromium-webkit',
    ...E2E_RUN_PRESETS.chromiumWebkit.environment,
  },
  E2E_RUN_PRESETS.chromiumWebkit.projects.flatMap((project) => ['--project', project]),
);

// Run Firefox even if the Chromium and WebKit invocation failed.
const firefox = run(
  'Firefox/Gecko',
  {
    CAPACITYLENS_E2E_PHASE: 'firefox',
    ...E2E_RUN_PRESETS.firefoxOnly.environment,
  },
  E2E_RUN_PRESETS.firefoxOnly.projects.flatMap((project) => ['--project', project]),
);

process.exit(chromeWebkit || firefox);
