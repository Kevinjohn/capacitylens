import { defineConfig, devices } from '@playwright/test'

// Playwright drives the real app via Vite. Three project flavours:
//   chromium    — the in-memory DEMO build on :5173 (VITE_CAPACITYLENS_DEMO=1; the existing specs).
//   db-backed   — the SQLite server (:8787, reset enabled, temp DB) + a second Vite
//                 dev server (:5273) whose same-origin /api proxy targets that server
//                 through the entity-level ServerSyncAdapter. *.db.spec.ts run here.
//   auth-backed — a third server (:8887) booted with CAPACITYLENS_AUTH=password (fresh DB per
//                 run) + a Vite dev server (:5373) whose /api proxy targets it — the ONLY place the
//                 flag-gated login screen exists (US-NAV-10). *.auth.spec.ts run here.
const API_PORT = 8787
const DB_WEB_PORT = 5273
const AUTH_API_PORT = 8887
const AUTH_WEB_PORT = 5373

// Cross-browser opt-in (WebKit/Safari + Firefox/Gecko). `e2e:webkit` / `e2e:firefox` set the
// matching *_ONLY flag: each runs ONLY that browser's twin of the core in-memory demo specs against
// the :5173 dev server, so it needs neither the SQLite nor the auth server — and pointedly NOT
// Node 24 (those servers need node:sqlite; the core specs don't). `e2e:browsers`
// (scripts/e2e-browsers.mjs) runs the core specs on all THREE engines (Chromium+WebKit, then
// Firefox) Vite-only via CAPACITYLENS_VITE_ONLY; `e2e:all` (scripts/e2e-all.mjs) adds the db/auth server
// specs (Chromium-only) on top. Both run Firefox last + unconditionally — see those scripts for why.
// A *_ONLY flag (or its un-suffixed sibling CAPACITYLENS_WEBKIT / CAPACITYLENS_FIREFOX) makes that browser's
// project exist; CAPACITYLENS_VITE_ONLY (or either *_ONLY) trims the webServer list to Vite-only.
const webkitOnly = !!process.env.CAPACITYLENS_WEBKIT_ONLY
const firefoxOnly = !!process.env.CAPACITYLENS_FIREFOX_ONLY
const webkitEnabled = webkitOnly || !!process.env.CAPACITYLENS_WEBKIT
const firefoxEnabled = firefoxOnly || !!process.env.CAPACITYLENS_FIREFOX
// True when the run touches only the core in-memory demo specs, so the SQLite + auth servers
// aren't needed and the webServer list trims to Vite alone: set directly by CAPACITYLENS_VITE_ONLY (the
// cross-engine `e2e:browsers` core run) and implied by either single-engine *_ONLY flag.
const viteOnly = !!process.env.CAPACITYLENS_VITE_ONLY || webkitOnly || firefoxOnly

// The base app under Vite on :5173 — the only server the core (and WebKit/Firefox) specs need.
// Runs the in-memory DEMO build so the core specs stay backend-free now that server is the
// app's default; the db/auth flavours below carry their own proxy target.
const devWebServer = {
  command: 'pnpm run dev:demo',
  url: 'http://localhost:5173',
  // Never reuse: Playwright matches a running server by URL (:5173) only — it can't see the
  // persistence flavour. Post-flip, `pnpm run dev` boots a SERVER-mode dev server on :5173; reusing
  // that for the in-memory demo specs would run them against the wrong backend. Always spawn a
  // fresh demo build (the CI guard is moot now that we never reuse).
  // CONSEQUENCE: if a full-stack `pnpm run dev` is already holding :5173, this spawn collides
  // (strictPort) and `pnpm run e2e` fails to start rather than reusing it — BY DESIGN (a reused
  // server-mode :5173 would corrupt the demo specs). Stop `pnpm run dev` first.
  reuseExistingServer: false,
  timeout: 120_000,
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /\.(db|auth)\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
    },
    {
      name: 'db-backed',
      testMatch: /\.db\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DB_WEB_PORT}` },
    },
    {
      name: 'auth-backed',
      testMatch: /\.auth\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${AUTH_WEB_PORT}` },
    },
    // Safari/WebKit & Firefox twins of the core in-memory demo specs (owner; WebKit 2026-06-13,
    // Firefox 2026-06-16): the exact same specs as `chromium` (testIgnore matches), run on the
    // other engines to catch Safari-/Gecko-only rendering and interaction regressions. Kept OUT of
    // the default `pnpm run e2e` so Chrome stays the fast inner loop — opt in with `pnpm run
    // e2e:webkit` / `pnpm run e2e:firefox` (one project each) or `pnpm run e2e:all` (full matrix).
    // The db-backed/auth-backed flavours stay Chrome-only: they exercise server round-trips and
    // the persistence seam, not cross-engine rendering.
    ...(webkitEnabled
      ? [
          {
            name: 'webkit',
            testIgnore: /\.(db|auth)\.spec\.ts$/,
            use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:5173' },
          },
        ]
      : []),
    ...(firefoxEnabled
      ? [
          {
            name: 'firefox',
            testIgnore: /\.(db|auth)\.spec\.ts$/,
            // No `dependencies` here on purpose: `e2e:all` sequences Firefox AFTER the WebKit matrix
            // at the SCRIPT level (scripts/e2e-all.mjs runs two invocations) so Firefox runs
            // unconditionally — a project dependency on `webkit` would SKIP Firefox whenever the
            // WebKit pass had a single failure, hiding Firefox-only regressions.
            use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:5173' },
          },
        ]
      : []),
    // Phase 6 rehearsal (docs/runbook.md): exists only when CAPACITYLENS_REHEARSAL_URL is set —
    // the PRODUCTION build served behind a local /api proxy (scripts/serve-dist.mjs), with
    // the droplet's flags ON in the daemon. Reuses the db-backed specs verbatim; the
    // baseURL override is the only difference. Started by hand per the runbook, so the
    // dev webServers below are skipped for these runs (see the webServer conditional).
    ...(process.env.CAPACITYLENS_REHEARSAL_URL
      ? [
          {
            name: 'rehearsal',
            testMatch: /\.db\.spec\.ts$/,
            use: { ...devices['Desktop Chrome'], baseURL: process.env.CAPACITYLENS_REHEARSAL_URL },
          },
        ]
      : []),
  ],
  // Rehearsal runs bring their own production-shaped stack (runbook) — don't boot the dev
  // servers under them. A core-specs-only run (`e2e:webkit`/`e2e:firefox`/`e2e:browsers`, i.e.
  // viteOnly) needs only Vite on :5173. Every other run keeps the full list (the SQLite + auth
  // servers the db/auth specs depend on).
  webServer: process.env.CAPACITYLENS_REHEARSAL_URL
    ? []
    : viteOnly
      ? [devWebServer]
      : [
          devWebServer,
          {
            command: 'pnpm run start:e2e',
            cwd: './server',
            url: `http://localhost:${API_PORT}/api/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
          {
            command: 'pnpm run dev:api',
            url: `http://localhost:${DB_WEB_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            // Match the packaged nginx topology: the browser stays same-origin and Vite proxies
            // /api. This keeps the production CSP meaningful in E2E instead of granting a test-only
            // cross-origin exception that the shipped app never has.
            env: { CAPACITYLENS_DEV_API_PORT: String(API_PORT) },
          },
          {
            // CAPACITYLENS_AUTH=password + a dev-only secret live in the pnpm script; the DB file is
            // recreated on every boot so sign-up state never leaks between runs. NEVER reuse an
            // already-running :8887 — the wipe + CAPACITYLENS_CREATE_ADMIN_ADMIN bootstrap only run
            // on a fresh spawn, so an adopted stale server (older env, dirty DB) fails the
            // bootstrap-credential spec with a confusing red (same lesson as the :5173 block above
            // and the 2026-07-08 orphaned-:8787 war story in the decisions log).
            command: 'pnpm run start:auth-e2e',
            cwd: './server',
            url: `http://localhost:${AUTH_API_PORT}/api/health`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
          {
            command: 'pnpm run dev:auth',
            url: `http://localhost:${AUTH_WEB_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: { CAPACITYLENS_DEV_API_PORT: String(AUTH_API_PORT) },
          },
        ],
})
