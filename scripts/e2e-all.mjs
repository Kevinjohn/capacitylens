// Full cross-browser E2E run, used by `npm run e2e:all`. Runs in TWO sequential Playwright
// invocations rather than one, so the alt-engines run in series (Chromium matrix incl.
// WebKit/Safari first, then Firefox/Gecko) AND Firefox runs UNCONDITIONALLY — even if the first
// invocation goes red. We deliberately do NOT sequence Firefox via a Playwright project
// `dependency`: Playwright SKIPS a dependent project when its dependency fails, which would drop
// Firefox results from a full run whenever WebKit had a single failure. The owner wants every
// engine's results from a full run, always — a red WebKit pass must not hide a Firefox regression.
//
// Exit code is non-zero if EITHER invocation failed (so `npm run e2e:all` still fails the gate),
// but both always run to completion first. Each invocation manages its own webServers: the matrix
// run boots Vite + the SQLite/auth servers (db/auth specs need them); the Firefox run is
// FLOATY_FIREFOX_ONLY, so it boots Vite only (no Node 24 / no server) — see playwright.config.ts.
//
//   node scripts/e2e-all.mjs   # = npm run e2e:all

import { spawnSync } from 'node:child_process'

/** Run one Playwright invocation to completion; return its exit status (1 if it never started). */
function run(label, env, extraArgs = []) {
  console.log(`\n=== e2e:all — ${label} ===`)
  const res = spawnSync('npx', ['playwright', 'test', ...extraArgs], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  return res.status ?? 1
}

// 1) Chromium + db-backed + auth-backed + WebKit/Safari, in one run (FLOATY_WEBKIT enables the
//    webkit project; FLOATY_FIREFOX is intentionally unset so Firefox is NOT in this invocation).
const matrix = run('Chromium + WebKit/Safari', { FLOATY_WEBKIT: '1' })

// 2) Firefox/Gecko on its own, AFTER the matrix — runs even when the matrix above failed.
const firefox = run('Firefox/Gecko', { FLOATY_FIREFOX_ONLY: '1' }, ['--project', 'firefox'])

// Fail the run if either engine failed; 0 only when BOTH passed.
process.exit(matrix || firefox)
