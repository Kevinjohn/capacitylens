// `pnpm run e2e:browsers` runs the core in-memory demo specs on all three engines: Chromium +
// WebKit/Safari first, then Firefox/Gecko second. Pure cross-browser rendering coverage. It does
// not run the db-backed/auth-backed specs (those are Chromium-only server round-trips), so every
// invocation is CAPACITYLENS_VITE_ONLY: it boots Vite alone and needs neither the SQLite/auth servers
// nor Node 24. (`e2e:all` is the superset that also runs those server specs.)
//
// Same two-invocation shape and rationale as scripts/e2e-all.mjs: Firefox runs second and
// unconditionally, even if the Chromium+WebKit pass fails, rather than via a Playwright
// project `dependency` (which skips the dependent when its dependency fails, hiding a Firefox-only
// regression). Exit code is non-zero if either invocation failed, but both always run first.
//

import { nonColourEnvironment, spawnPnpmSync, reportSpawnFailureAndResolveExitStatus } from "./pnpmSpawn.mjs";
import { E2E_RUN_PRESETS, presetEnvironment } from "./playwrightRunMode.mjs";

const forwardedArgs = process.argv.slice(2);

/** Run one Playwright invocation to completion; return its exit status (2 if it never started). */
function run(label, env, extraArgs = []) {
  console.log(`\n=== e2e:browsers — ${label} ===`);
  const res = spawnPnpmSync(["exec", "playwright", "test", ...extraArgs, ...forwardedArgs], {
    stdio: "inherit",
    env: nonColourEnvironment({}, presetEnvironment(process.env, env)),
  });
  return reportSpawnFailureAndResolveExitStatus(`e2e:browsers ${label}`, res);
}

const chromeWebkit = run(
  "Chromium + WebKit/Safari",
  {
    CAPACITYLENS_E2E_PHASE: "chromium-webkit",
    ...E2E_RUN_PRESETS.chromiumWebkit.environment,
  },
  E2E_RUN_PRESETS.chromiumWebkit.projects.flatMap((project) => ["--project", project]),
);

// Run Firefox even if the Chromium and WebKit invocation failed.
const firefox = run(
  "Firefox/Gecko",
  {
    CAPACITYLENS_E2E_PHASE: "firefox",
    ...E2E_RUN_PRESETS.firefoxOnly.environment,
  },
  E2E_RUN_PRESETS.firefoxOnly.projects.flatMap((project) => ["--project", project]),
);

process.exit(chromeWebkit || firefox);
