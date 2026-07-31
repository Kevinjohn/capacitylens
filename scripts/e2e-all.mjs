// Full cross-browser E2E run, used by `pnpm run e2e:all`. Runs in THREE sequential Playwright
// invocations: Chromium plus the DB/auth projects, WebKit/Safari, then Firefox/Gecko. Giving each
// browser an isolated Vite lifecycle prevents intermittent module-load failures caused by the
// WebKit project sharing a busy invocation with three independently managed app/API stacks. Every
// later invocation runs UNCONDITIONALLY even if an earlier one goes red. We deliberately do NOT
// sequence the engines via Playwright project
// `dependency`: Playwright SKIPS a dependent project when its dependency fails, which would drop
// Firefox results from a full run whenever WebKit had a single failure. The owner wants every
// engine's results from a full run, always — a red WebKit pass must not hide a Firefox regression.
//
// Exit code is non-zero if ANY invocation failed (so `pnpm run e2e:all` still fails the gate), but
// all three always run to completion first. The Chromium run boots Vite + the SQLite/auth servers;
// each alternative engine uses its *_ONLY flag and boots one Vite server only — see
// playwright.config.ts.
//
//   node scripts/e2e-all.mjs   # = pnpm run e2e:all

import { nonColourEnvironment, spawnPnpmSync, synchronousSpawnStatus } from "./pnpm-spawn.mjs";
import { E2E_RUN_PRESETS } from "./playwright-run-mode.mjs";

const forwardedArgs = process.argv.slice(2);

/** Run one Playwright invocation to completion; return its exit status (1 if it never started). */
function run(label, env, extraArgs = []) {
  console.log(`\n=== e2e:all — ${label} ===`);
  const res = spawnPnpmSync(["exec", "playwright", "test", ...extraArgs, ...forwardedArgs], {
    stdio: "inherit",
    env: nonColourEnvironment(env),
  });
  return synchronousSpawnStatus(`e2e:all ${label}`, res);
}

// 1) Chromium plus the DB/auth projects. No alternative-engine flag means the three server-backed
//    projects retain their ordinary browser and get the only multi-server invocation.
const chromium = run("Chromium + DB/auth", {
  CAPACITYLENS_E2E_PHASE: "chromium-server",
  ...E2E_RUN_PRESETS.standard.environment,
});

// 2) WebKit/Safari against one Vite server, even when Chromium failed.
const webkit = run(
  "WebKit/Safari",
  {
    CAPACITYLENS_E2E_PHASE: "webkit",
    ...E2E_RUN_PRESETS.webkitOnly.environment,
  },
  E2E_RUN_PRESETS.webkitOnly.projects.flatMap((project) => ["--project", project]),
);

// 3) Firefox/Gecko against one Vite server, even when either earlier invocation failed.
const firefox = run(
  "Firefox/Gecko",
  {
    CAPACITYLENS_E2E_PHASE: "firefox",
    ...E2E_RUN_PRESETS.firefoxOnly.environment,
  },
  E2E_RUN_PRESETS.firefoxOnly.projects.flatMap((project) => ["--project", project]),
);

// Fail the run if any engine failed; 0 only when ALL passed.
process.exit(chromium || webkit || firefox);
