import { defineConfig, devices } from '@playwright/test';
import { parseReportPhaseName } from './scripts/playwrightServerScope';
import { resolvePlaywrightRunMode } from './scripts/playwrightRunMode.mjs';
import { configurationWorkerCount } from './scripts/playwrightWorkers.mjs';
import { ports } from './scripts/ports.mjs';

const lanePorts = ports();
const runMode = resolvePlaywrightRunMode(process.env);
const projectEnabled = (name: (typeof runMode.projects)[number]) => runMode.projects.includes(name);
const reportPhase = parseReportPhaseName(process.env.CAPACITYLENS_E2E_PHASE);
const specExtension = String.raw`(?:ts|tsx|mts|cts)`;
const dbSpec = new RegExp(String.raw`\.db\.spec\.${specExtension}$`, 'i');
const authSpec = new RegExp(String.raw`\.auth\.spec\.${specExtension}$`, 'i');

const authApiServer = {
  command: 'pnpm run start:auth-e2e',
  cwd: './apps/backend',
  url: `http://127.0.0.1:${lanePorts.authApi}/health/ready`,
  reuseExistingServer: false,
  timeout: 120_000,
};
const authWebServer = {
  command: 'pnpm run dev:auth',
  url: `http://127.0.0.1:${lanePorts.authWeb}/health/ready`,
  reuseExistingServer: false,
  timeout: 120_000,
  env: { CAPACITYLENS_DEV_API_PORT: String(lanePorts.authApi), VITE_CAPACITYLENS_API: '' },
};

/** Each `*.db.spec.ts` project owns one real SQLite-backed worker server. */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: true,
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: configurationWorkerCount(),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { outputFolder: `playwright-report/${reportPhase}`, open: 'never' }],
        ['junit', { outputFile: `test-results/${reportPhase}.xml` }],
      ]
    : 'list',
  outputDir: `test-results/artifacts/${reportPhase}`,
  use: { trace: 'on-first-retry' },
  projects: [
    ...(projectEnabled('chromium')
      ? [
          {
            name: 'chromium',
            testMatch: dbSpec,
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    ...(projectEnabled('auth-backed')
      ? [
          {
            name: 'auth-backed',
            testMatch: authSpec,
            testIgnore: '**/microsoft-verification.auth.spec.ts',
            workers: 1,
            use: {
              ...devices['Desktop Chrome'],
              baseURL: `http://localhost:${lanePorts.authWeb}`,
            },
          },
        ]
      : []),
    ...(projectEnabled('webkit')
      ? [
          {
            name: 'webkit',
            testMatch: dbSpec,
            use: { ...devices['Desktop Safari'] },
          },
        ]
      : []),
    ...(projectEnabled('firefox')
      ? [
          {
            name: 'firefox',
            testMatch: dbSpec,
            use: { ...devices['Desktop Firefox'] },
          },
        ]
      : []),
  ],
  ...(runMode.serverProfile === 'standard' && projectEnabled('auth-backed')
    ? { webServer: [authApiServer, authWebServer] }
    : {}),
});
