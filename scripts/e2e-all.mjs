// Run engines sequentially to isolate their server lifecycles. Every engine must still run after an earlier failure.
// Playwright dependencies skip failed dependants, so orchestration owns the sequence and aggregates exit statuses.
//

import { nonColourEnvironment, spawnPnpmSync, reportSpawnFailureAndResolveExitStatus } from "./pnpmSpawn.mjs";
import { E2E_RUN_PRESETS, presetEnvironment } from "./playwrightRunMode.mjs";

const forwardedArgs = process.argv.slice(2);

/** Run one Playwright invocation to completion; return its exit status (2 if it never started). */
function run(label, env, extraArgs = []) {
  console.log(`\n=== e2e:all — ${label} ===`);
  const res = spawnPnpmSync(["exec", "playwright", "test", ...extraArgs, ...forwardedArgs], {
    stdio: "inherit",
    env: nonColourEnvironment({}, presetEnvironment(process.env, env)),
  });
  return reportSpawnFailureAndResolveExitStatus(`e2e:all ${label}`, res);
}

const chromium = run("Chromium + DB/auth", {
  CAPACITYLENS_E2E_PHASE: "chromium-server",
  ...E2E_RUN_PRESETS.standard.environment,
});

const webkit = run(
  "WebKit/Safari",
  {
    CAPACITYLENS_E2E_PHASE: "webkit",
    ...E2E_RUN_PRESETS.webkitOnly.environment,
  },
  E2E_RUN_PRESETS.webkitOnly.projects.flatMap((project) => ["--project", project]),
);

const firefox = run(
  "Firefox/Gecko",
  {
    CAPACITYLENS_E2E_PHASE: "firefox",
    ...E2E_RUN_PRESETS.firefoxOnly.environment,
  },
  E2E_RUN_PRESETS.firefoxOnly.projects.flatMap((project) => ["--project", project]),
);

process.exit(chromium || webkit || firefox);
