import { defineConfig, devices } from "@playwright/test";
import { coreSpecPattern, parseReportPhaseName, selectsOnlyExplicitCoreSpecs } from "./scripts/playwrightServerScope";
import { resolvePlaywrightRunMode } from "./scripts/playwrightRunMode.mjs";
import { ports, testShare } from "./scripts/ports.mjs";

// Playwright drives the app through Vite in three project groups:
//   chromium: in-memory demo on the lane web port.
//   db-backed: temporary SQLite server plus a Vite proxy; *.db.spec.ts run here.
//   auth-backed: password-only server plus a Vite proxy, where the login screen exists (US-NAV-10).
// Each worktree receives isolated lane ports for concurrent runs. Global setup runs too late
// to choose them, so the lane must set them before this file is evaluated.
const lanePorts = ports();
const WEB_PORT = lanePorts.web;
const API_PORT = lanePorts.dbApi;
const DB_WEB_PORT = lanePorts.dbWeb;
const AUTH_API_PORT = lanePorts.authApi;
const AUTH_WEB_PORT = lanePorts.authWeb;
const specExtension = String.raw`(?:ts|tsx|mts|cts)`;
const coreSpec = coreSpecPattern;
const flavourSpec = (flavour: "db" | "auth") => new RegExp(String.raw`\.${flavour}\.spec\.${specExtension}$`, "i");

// WebKit and Firefox opt-ins run the core demo specs against Vite without SQLite or auth servers.
// e2e:browsers runs the core specs on all three engines. e2e:all runs Chromium's server-backed
// specs, then starts isolated Vite-only runs for WebKit and Firefox; later engines still run
// after an earlier engine fails. CAPACITYLENS_WEBKIT or CAPACITYLENS_FIREFOX enables its project.
// The matching *_ONLY flag also selects Vite-only servers; CAPACITYLENS_VITE_ONLY selects them
// without limiting the browser projects.
const runMode = resolvePlaywrightRunMode(process.env, process.argv, selectsOnlyExplicitCoreSpecs);
const projectEnabled = (name: (typeof runMode.projects)[number]) => runMode.projects.includes(name);
const reportPhase = parseReportPhaseName(process.env.CAPACITYLENS_E2E_PHASE);

// Core and cross-browser specs use the in-memory demo server. Database and auth projects have
// their own Vite proxies and API targets.
const devWebServer = {
  command: "pnpm run dev:demo",
  url: `http://localhost:${WEB_PORT}`,
  // Never reuse: Playwright identifies a running server by URL, not persistence mode. Reusing a
  // server-mode process would run in-memory demo specs against the wrong backend. Each run starts
  // a fresh demo build; lane allocation prevents concurrent worktrees from colliding.
  reuseExistingServer: false,
  timeout: 120_000,
};

/** Configures isolated browser projects and servers for the selected port lane and E2E mode. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // A committed test.only is equally dangerous locally and in CI; reject it in every invocation.
  forbidOnly: true,
  // These are measured suite budgets, stated explicitly instead of inheriting Playwright defaults.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // This run's CPU reservation (scripts/laneClaims.mjs). A solo run reserves half the cores, which
  // is exactly Playwright's own default; concurrent runs divide the machine instead of each taking
  // that half. Every worker drives a browser, so the reservation is the right unit here.
  workers: testShare(),
  retries: process.env.CI ? 2 : 0,
  // Only db-backed and rehearsal share a mutable SQLite fixture, so each sets workers to one.
  // Chromium and auth-backed tests use isolated browser contexts and can run in parallel.
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { outputFolder: `playwright-report/${reportPhase}`, open: "never" }],
        ["junit", { outputFile: `test-results/${reportPhase}.xml` }],
      ]
    : "list",
  outputDir: `test-results/artifacts/${reportPhase}`,
  use: {
    trace: "on-first-retry",
  },
  projects: [
    ...(projectEnabled("chromium")
      ? [
          {
            name: "chromium",
            testMatch: coreSpec,
            use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${WEB_PORT}` },
          },
        ]
      : []),
    ...(projectEnabled("db-backed")
      ? [
          {
            name: "db-backed",
            testMatch: flavourSpec("db"),
            // Every DB-backed test resets the same SQLite fixture in beforeEach. Running those resets
            // concurrently can abort another page's in-flight account read and makes the suite pass by
            // luck against mutually changing state. Keep this one shared-database project serial; the
            // browser-only and auth projects retain their normal parallelism.
            workers: 1,
            use: {
              ...devices["Desktop Chrome"],
              baseURL: `http://localhost:${DB_WEB_PORT}`,
            },
          },
          {
            name: "auth-backed",
            testMatch: flavourSpec("auth"),
            use: {
              ...devices["Desktop Chrome"],
              baseURL: `http://localhost:${AUTH_WEB_PORT}`,
            },
          },
        ]
      : []),
    // WebKit and Firefox run the same in-memory demo specs as Chromium to catch engine-specific
    // rendering and interaction regressions. They are opt-in so the default e2e command stays fast.
    // Database and auth projects remain Chromium-only because they cover server and persistence flows.
    ...(projectEnabled("webkit")
      ? [
          {
            name: "webkit",
            testMatch: coreSpec,
            use: {
              ...devices["Desktop Safari"],
              baseURL: `http://localhost:${WEB_PORT}`,
            },
          },
        ]
      : []),
    ...(projectEnabled("firefox")
      ? [
          {
            name: "firefox",
            testMatch: coreSpec,
            // Firefox runs separately, so a WebKit failure cannot skip it.
            use: {
              ...devices["Desktop Firefox"],
              baseURL: `http://localhost:${WEB_PORT}`,
            },
          },
        ]
      : []),
    // The browser-upgrade rehearsal exists only when CAPACITYLENS_REHEARSAL_URL is set.
    ...(projectEnabled("rehearsal")
      ? [
          {
            name: "rehearsal",
            testMatch: flavourSpec("db"),
            // Rehearsal reuses the DB specs, whose resets share one SQLite fixture, so this project must remain serial.
            workers: 1,
            use: {
              ...devices["Desktop Chrome"],
              baseURL: process.env.CAPACITYLENS_REHEARSAL_URL,
            },
          },
        ]
      : []),
  ],
  // Rehearsal runs provide their own stack. Cross-browser core runs need only Vite; other runs
  // start the SQLite and auth servers required by their specs.
  webServer:
    runMode.serverProfile === "rehearsal"
      ? []
      : runMode.serverProfile === "vite"
        ? [devWebServer]
        : [
            devWebServer,
            {
              command: "pnpm run start:e2e",
              cwd: "./server",
              url: `http://localhost:${API_PORT}/api/health`,
              reuseExistingServer: false,
              timeout: 120_000,
            },
            {
              command: "pnpm run dev:api",
              // Warm and verify the browser's real Vite → API path before the first page mounts.
              // Waiting on the Vite root alone can race its first proxied fetch on a cold start.
              url: `http://localhost:${DB_WEB_PORT}/api/health`,
              reuseExistingServer: false,
              timeout: 120_000,
              // Match the packaged nginx topology: the browser stays same-origin and Vite proxies
              // /api. This keeps the production CSP meaningful in E2E instead of granting a test-only
              // cross-origin exception that the shipped app never has.
              env: { CAPACITYLENS_DEV_API_PORT: String(API_PORT), VITE_CAPACITYLENS_API: "" },
            },
            {
              // Start a fresh auth API for each run because its database wipe and admin bootstrap
              // execute only during startup.
              command: "pnpm run start:auth-e2e",
              cwd: "./server",
              url: `http://localhost:${AUTH_API_PORT}/api/health`,
              reuseExistingServer: false,
              timeout: 120_000,
            },
            {
              command: "pnpm run dev:auth",
              url: `http://localhost:${AUTH_WEB_PORT}/api/health`,
              reuseExistingServer: false,
              timeout: 120_000,
              env: { CAPACITYLENS_DEV_API_PORT: String(AUTH_API_PORT), VITE_CAPACITYLENS_API: "" },
            },
          ],
});
