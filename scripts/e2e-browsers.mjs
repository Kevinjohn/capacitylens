// `pnpm run e2e:browsers` — the core (localStorage) specs on ALL THREE engines: Chromium +
// WebKit/Safari first, then Firefox/Gecko second. Pure cross-browser rendering coverage — it does
// NOT run the db-backed/auth-backed specs (those are Chromium-only server round-trips), so every
// invocation is CAPACITYLENS_VITE_ONLY: it boots Vite alone and needs neither the SQLite/auth servers
// nor Node 24. (`e2e:all` is the superset that also runs those server specs.)
//
// Same two-invocation shape and rationale as scripts/e2e-all.mjs: Firefox runs SECOND and
// UNCONDITIONALLY — even if the Chromium+WebKit pass went red — rather than via a Playwright
// project `dependency` (which SKIPS the dependent when its dependency fails, hiding a Firefox-only
// regression). Exit code is non-zero if EITHER invocation failed, but both always run first.
//
//   node scripts/e2e-browsers.mjs   # = pnpm run e2e:browsers

import { spawnSync } from 'node:child_process'

/** Run one Playwright invocation to completion; return its exit status (1 if it never started). */
function run(label, env, extraArgs = []) {
  console.log(`\n=== e2e:browsers — ${label} ===`)
  const res = spawnSync('pnpm', ['exec', 'playwright', 'test', ...extraArgs], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    // shell: true so `pnpm` resolves on Windows (pnpm is pnpm.cmd there); mirrors dev-fullstack.mjs.
    shell: true,
  })
  return res.status ?? 1
}

// 1) Chromium + WebKit/Safari core specs in one Vite-only run. CAPACITYLENS_WEBKIT makes the webkit
//    project exist; CAPACITYLENS_VITE_ONLY trims the webServer list to Vite (no SQLite/auth server);
//    the --project filters pick the two engines (so the db/auth projects don't run even though
//    they're defined). CAPACITYLENS_FIREFOX stays unset, so Firefox is NOT in this invocation.
const chromeWebkit = run(
  'Chromium + WebKit/Safari',
  { CAPACITYLENS_WEBKIT: '1', CAPACITYLENS_VITE_ONLY: '1' },
  ['--project', 'chromium', '--project', 'webkit'],
)

// 2) Firefox/Gecko core specs on its own, AFTER the above — runs even when it failed.
const firefox = run('Firefox/Gecko', { CAPACITYLENS_FIREFOX_ONLY: '1' }, ['--project', 'firefox'])

// Fail the run if either engine failed; 0 only when BOTH passed.
process.exit(chromeWebkit || firefox)
