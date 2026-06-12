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
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
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
