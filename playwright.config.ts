import { defineConfig, devices } from '@playwright/test'
import type { ReporterDescription } from '@playwright/test'
import { parseReportPhaseName } from './scripts/e2e/playwrightServerScope'
import { resolvePlaywrightRunMode } from './scripts/e2e/playwrightRunMode.mjs'
import { configurationWorkerCount } from './scripts/e2e/playwrightWorkers.mjs'
import { ports } from './tooling/ports.mjs'

const portLanePorts = ports()
const runMode = resolvePlaywrightRunMode(process.env)
const projectEnabled = (name: (typeof runMode.projects)[number]) => runMode.projects.includes(name)
const reportPhase = parseReportPhaseName(process.env.CAPACITYLENS_E2E_PHASE)
const reporters: ReporterDescription[] = process.env.CI
  ? [
      ['github'],
      ['html', { outputFolder: `playwright-report/${reportPhase}`, open: 'never' }],
      ['junit', { outputFile: `test-results/${reportPhase}.xml` }],
    ]
  : [['list']]
const specExtension = String.raw`(?:ts|tsx|mts|cts)`
const dbSpec = new RegExp(String.raw`\.db\.spec\.${specExtension}$`, 'i')
const authSpec = new RegExp(String.raw`\.auth\.spec\.${specExtension}$`, 'i')
// WebKit and Firefox run only the tests whose result can differ between engines; Chromium runs all.
const engineSensitive = /@engine/

const authApiServer = {
  command: 'pnpm run start:auth-e2e',
  cwd: './apps/backend',
  url: `http://127.0.0.1:${portLanePorts.authApi}/health/ready`,
  reuseExistingServer: false,
  timeout: 120_000,
}
const authWebServer = {
  command: 'pnpm run dev:auth',
  url: `http://127.0.0.1:${portLanePorts.authWeb}/health/ready`,
  reuseExistingServer: false,
  timeout: 120_000,
  env: { CAPACITYLENS_DEV_API_PORT: String(portLanePorts.authApi) },
}

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
  reporter: reporters,
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
            workers: 1,
            use: {
              ...devices['Desktop Chrome'],
              baseURL: `http://localhost:${portLanePorts.authWeb}`,
            },
          },
        ]
      : []),
    ...(projectEnabled('webkit')
      ? [
          {
            name: 'webkit',
            testMatch: dbSpec,
            grep: engineSensitive,
            use: { ...devices['Desktop Safari'] },
          },
        ]
      : []),
    ...(projectEnabled('firefox')
      ? [
          {
            name: 'firefox',
            testMatch: dbSpec,
            grep: engineSensitive,
            use: { ...devices['Desktop Firefox'] },
          },
        ]
      : []),
  ],
  ...(runMode.serverProfile === 'standard' && projectEnabled('auth-backed')
    ? { webServer: [authApiServer, authWebServer] }
    : {}),
})
