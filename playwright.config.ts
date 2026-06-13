import { defineConfig, devices } from '@playwright/test'

// Playwright drives the real app via Vite. Three project flavours:
//   chromium    — the default localStorage-backed app on :5173 (the existing specs).
//   db-backed   — the SQLite server (:8787, reset enabled, temp DB) + a second Vite
//                 dev server (:5273) built with VITE_FLOATY_API so the app persists
//                 through the entity-level ServerSyncAdapter. *.db.spec.ts run here.
//   auth-backed — a third server (:8887) booted with FLOATY_AUTH=password (fresh DB per
//                 run) + a Vite dev server (:5373) pointed at it — the ONLY place the
//                 flag-gated login screen exists (US-NAV-10). *.auth.spec.ts run here.
const API_PORT = 8787
const DB_WEB_PORT = 5273
const AUTH_API_PORT = 8887
const AUTH_WEB_PORT = 5373

// Safari/WebKit opt-in. `e2e:webkit` sets FLOATY_WEBKIT_ONLY: it runs ONLY the WebKit twin
// of the core localStorage specs against the :5173 dev server, so it needs neither the SQLite
// nor the auth server — and pointedly NOT Node 24 (those servers need node:sqlite; the core
// specs don't). `e2e:all` sets FLOATY_WEBKIT: full stack, every project. Either flag makes the
// `webkit` project exist.
const webkitOnly = !!process.env.FLOATY_WEBKIT_ONLY
const webkitEnabled = webkitOnly || !!process.env.FLOATY_WEBKIT

// The base app under Vite on :5173 — the only server the core (and WebKit) specs need.
const devWebServer = {
  command: 'npm run dev',
  url: 'http://localhost:5173',
  reuseExistingServer: !process.env.CI,
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
    // Safari/WebKit twin of the core localStorage specs (owner, 2026-06-13): the exact same
    // specs as `chromium` (testIgnore matches), run on WebKit to catch Safari-only rendering
    // and interaction regressions. Kept OUT of the default `npm run e2e` so Chrome stays the
    // fast inner loop — opt in with `npm run e2e:webkit` (this project only) or `npm run
    // e2e:all` (full matrix). The db-backed/auth-backed flavours stay Chrome-only: they
    // exercise server round-trips and the persistence seam, not Safari rendering.
    ...(webkitEnabled
      ? [
          {
            name: 'webkit',
            testIgnore: /\.(db|auth)\.spec\.ts$/,
            use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:5173' },
          },
        ]
      : []),
    // Phase 6 rehearsal (docs/runbook.md): exists only when FLOATY_REHEARSAL_URL is set —
    // the PRODUCTION build served behind a local /api proxy (scripts/serve-dist.mjs), with
    // the droplet's flags ON in the daemon. Reuses the db-backed specs verbatim; the
    // baseURL override is the only difference. Started by hand per the runbook, so the
    // dev webServers below are skipped for these runs (see the webServer conditional).
    ...(process.env.FLOATY_REHEARSAL_URL
      ? [
          {
            name: 'rehearsal',
            testMatch: /\.db\.spec\.ts$/,
            use: { ...devices['Desktop Chrome'], baseURL: process.env.FLOATY_REHEARSAL_URL },
          },
        ]
      : []),
  ],
  // Rehearsal runs bring their own production-shaped stack (runbook) — don't boot the dev
  // servers under them. `e2e:webkit` (webkitOnly) needs only Vite on :5173. Every other run
  // keeps the full list (the SQLite + auth servers the db/auth specs depend on).
  webServer: process.env.FLOATY_REHEARSAL_URL
    ? []
    : webkitOnly
      ? [devWebServer]
      : [
          devWebServer,
          {
            command: 'npm run start:e2e',
            cwd: './server',
            url: `http://localhost:${API_PORT}/api/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
          {
            command: 'npm run dev:api',
            url: `http://localhost:${DB_WEB_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: { VITE_FLOATY_API: `http://localhost:${API_PORT}` },
          },
          {
            // FLOATY_AUTH=password + a dev-only secret live in the npm script; the DB file is
            // recreated on every boot so sign-up state never leaks between runs.
            command: 'npm run start:auth-e2e',
            cwd: './server',
            url: `http://localhost:${AUTH_API_PORT}/api/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
          {
            command: 'npm run dev:auth',
            url: `http://localhost:${AUTH_WEB_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: { VITE_FLOATY_API: `http://localhost:${AUTH_API_PORT}` },
          },
        ],
})
