import { defineConfig, devices } from '@playwright/test'

// Playwright drives the real app via Vite. Two project flavours:
//   chromium   — the default localStorage-backed app on :5173 (the existing specs).
//   db-backed  — the SQLite server (:8787, reset enabled, temp DB) + a second Vite
//                dev server (:5273) built with VITE_FLOATY_API so the app persists
//                through the entity-level ServerSyncAdapter. *.db.spec.ts run here.
const API_PORT = 8787
const DB_WEB_PORT = 5273

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
      testIgnore: /\.db\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
    },
    {
      name: 'db-backed',
      testMatch: /\.db\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DB_WEB_PORT}` },
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
  ],
})
