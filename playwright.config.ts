import { defineConfig, devices } from "@playwright/test";
import { coreSpecPattern, reportPhaseName, selectsOnlyExplicitCoreSpecs } from "./scripts/playwright-server-scope";
import { resolvePlaywrightRunMode } from "./scripts/playwright-run-mode.mjs";
import { OIDC_FIXED_PORTS, ports, testShare } from "./scripts/ports.mjs";

// Playwright drives the real app via Vite. Three project flavours:
//   chromium    — the in-memory DEMO build on the lane web port (VITE_CAPACITYLENS_DEMO=1).
//   db-backed   — the SQLite server (lane db API, reset enabled, temp DB) + a second Vite
//                 dev server (lane db web) whose same-origin /api proxy targets that server
//                 through the entity-level ServerSyncAdapter. *.db.spec.ts run here.
//   auth-backed — a third server (lane auth API) booted with SMALLSASS_ACCOUNT_MODE=password (fresh
//                 DB per run) + a Vite dev server (lane auth web) proxying to it — the ONLY place the
//                 flag-gated login screen exists (US-NAV-10). *.auth.spec.ts run here.
// Lane-derived (scripts/ports.mjs). Lane 0 is the historical 5173/5273/5373/8787/8887, so a single
// checkout and CI see no change; a run launched through scripts/with-lane.mjs gets its own lane, so
// ten worktrees can run this suite at once. The lane is already fixed in the environment by the
// time this file is evaluated — a globalSetup would claim one far too late to choose these ports.
const lanePorts = ports();
const WEB_PORT = lanePorts.web;
const API_PORT = lanePorts.dbApi;
const DB_WEB_PORT = lanePorts.dbWeb;
const AUTH_API_PORT = lanePorts.authApi;
const AUTH_WEB_PORT = lanePorts.authWeb;
// OIDC is deliberately NOT lane-derived: e2e/oidc/dex.yaml pins the issuer and callback, and
// scripts/e2e-oidc.mjs maps the dex host port fixedly in a container. `pnpm run e2e:oidc` is
// single-flight machine-wide and keeps its historical ports.
const OIDC_API_PORT = OIDC_FIXED_PORTS.oidcApi;
const OIDC_WEB_PORT = OIDC_FIXED_PORTS.oidcWeb;
const specExtension = String.raw`(?:ts|tsx|mts|cts)`;
const coreSpec = coreSpecPattern;
const flavourSpec = (flavour: "db" | "auth" | "oidc") =>
  new RegExp(String.raw`\.${flavour}\.spec\.${specExtension}$`, "i");

// Cross-browser opt-in (WebKit/Safari + Firefox/Gecko). `e2e:webkit` / `e2e:firefox` set the
// matching *_ONLY flag: each runs ONLY that browser's twin of the core in-memory demo specs against
// the lane web dev server, so it needs neither the SQLite nor the auth server — and pointedly NOT
// Node 24 (those servers need node:sqlite; the core specs don't). `e2e:browsers`
// (scripts/e2e-browsers.mjs) runs the core specs on all THREE engines (Chromium+WebKit, then
// Firefox) Vite-only via CAPACITYLENS_VITE_ONLY; `e2e:all` (scripts/e2e-all.mjs) runs Chromium with
// the db/auth server specs, then gives WebKit and Firefox isolated Vite-only invocations. Later
// engines run unconditionally — see those scripts for why.
// A *_ONLY flag (or its un-suffixed sibling CAPACITYLENS_WEBKIT / CAPACITYLENS_FIREFOX) makes that browser's
// project exist; CAPACITYLENS_VITE_ONLY (or either *_ONLY) trims the webServer list to Vite-only.
const runMode = resolvePlaywrightRunMode(process.env, process.argv, selectsOnlyExplicitCoreSpecs);
const projectEnabled = (name: (typeof runMode.projects)[number]) => runMode.projects.includes(name);
const reportPhase = reportPhaseName(process.env.CAPACITYLENS_E2E_PHASE);

// The base app under Vite on the lane web port — the only server the core (and WebKit/Firefox) specs need.
// Runs the in-memory DEMO build so the core specs stay backend-free now that server is the
// app's default; the db/auth flavours below carry their own proxy target.
const devWebServer = {
  command: "pnpm run dev:demo",
  url: `http://localhost:${WEB_PORT}`,
  // Never reuse: Playwright matches a running server by URL only — it can't see the persistence
  // flavour. Post-flip, `pnpm run dev` boots a SERVER-mode dev server on the same port; reusing that
  // for the in-memory demo specs would run them against the wrong backend. Always spawn a fresh
  // demo build (the CI guard is moot now that we never reuse).
  // CONSEQUENCE: if something is already holding this lane's web port, the spawn collides
  // (strictPort) and the run fails to start rather than reusing it — BY DESIGN. Lanes are what stop
  // that being another worktree: scripts/with-lane.mjs gives each concurrent run its own port, and
  // clears this worktree's own orphans first. A full-stack `pnpm run dev` in THIS worktree still
  // holds this lane's port, so stop it first.
  reuseExistingServer: false,
  timeout: 120_000,
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // A committed test.only is equally dangerous locally and in CI; reject it in every invocation.
  forbidOnly: true,
  // These are measured suite budgets, stated explicitly instead of inheriting Playwright defaults.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // This run's CPU reservation (scripts/lane-claim.mjs). A solo run reserves half the cores, which
  // is exactly Playwright's own default; concurrent runs divide the machine instead of each taking
  // that half. Every worker drives a browser, so the reservation is the right unit here.
  workers: testShare(),
  retries: process.env.CI ? 2 : 0,
  // No global override here on purpose: only db-backed and rehearsal share a mutable SQLite
  // fixture across tests (see their own `workers: 1`, below) — chromium, auth-backed, and
  // oidc-backed are per-test-isolated (fresh browser context; auth specs mint unique
  // emails/orgs per test, e.g. login.auth.spec.ts's `${Date.now()}-${testInfo.workerIndex}`
  // suffix) and are safe at Playwright's default parallelism, including on CI.
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
    ...(projectEnabled("oidc-backed")
      ? [
          {
            name: "oidc-backed",
            testMatch: flavourSpec("oidc"),
            use: {
              ...devices["Desktop Chrome"],
              baseURL: `http://localhost:${OIDC_WEB_PORT}`,
            },
          },
        ]
      : []),
    // Safari/WebKit & Firefox twins of the core in-memory demo specs (owner; WebKit 2026-06-13,
    // Firefox 2026-06-16): the exact same specs as `chromium` (testIgnore matches), run on the
    // other engines to catch Safari-/Gecko-only rendering and interaction regressions. Kept OUT of
    // the default `pnpm run e2e` so Chrome stays the fast inner loop — opt in with `pnpm run
    // e2e:webkit` / `pnpm run e2e:firefox` (one project each) or `pnpm run e2e:all` (full matrix).
    // The db-backed/auth-backed flavours stay Chrome-only: they exercise server round-trips and
    // the persistence seam, not cross-engine rendering.
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
            // No `dependencies` here on purpose: `e2e:all` sequences Firefox AFTER the WebKit matrix
            // at the SCRIPT level (scripts/e2e-all.mjs runs two invocations) so Firefox runs
            // unconditionally — a project dependency on `webkit` would SKIP Firefox whenever the
            // WebKit pass had a single failure, hiding Firefox-only regressions.
            use: {
              ...devices["Desktop Firefox"],
              baseURL: `http://localhost:${WEB_PORT}`,
            },
          },
        ]
      : []),
    // Phase 6 rehearsal (docs-src/self-hosting/upgrades.md): exists only when CAPACITYLENS_REHEARSAL_URL is set —
    // the PRODUCTION build served behind a local /api proxy (scripts/serve-dist.mjs), with
    // the droplet's flags ON in the daemon. Reuses the db-backed specs verbatim; the
    // baseURL override is the only difference. Started by hand per the runbook, so the
    // dev webServers below are skipped for these runs (see the webServer conditional).
    ...(projectEnabled("rehearsal")
      ? [
          {
            name: "rehearsal",
            testMatch: flavourSpec("db"),
            // Reuses the db-backed specs verbatim (see comment above), so it inherits the same
            // shared-SQLite-fixture hazard: every *.db.spec resets the fixture in beforeEach, and
            // rehearsal is started by hand (CI unset), so the global CI-only workers guard above
            // never kicks in here. Serialize explicitly instead of relying on that.
            workers: 1,
            use: {
              ...devices["Desktop Chrome"],
              baseURL: process.env.CAPACITYLENS_REHEARSAL_URL,
            },
          },
        ]
      : []),
  ],
  // Rehearsal runs bring their own production-shaped stack (runbook) — don't boot the dev
  // servers under them. A core-specs-only run (`e2e:webkit`/`e2e:firefox`/`e2e:browsers`, i.e.
  // viteOnly) needs only Vite on the lane web port. Every other run keeps the full list (the SQLite + auth
  // servers the db/auth specs depend on).
  webServer:
    runMode.serverProfile === "rehearsal"
      ? []
      : runMode.serverProfile === "oidc"
        ? [
            {
              command: "pnpm run start:oidc-e2e",
              cwd: "./server",
              url: `http://localhost:${OIDC_API_PORT}/api/health`,
              reuseExistingServer: false,
              timeout: 120_000,
            },
            {
              command: "pnpm run dev:oidc",
              // Readiness must traverse Vite's /api proxy, not merely prove that Vite can serve HTML.
              url: `http://localhost:${OIDC_WEB_PORT}/api/health`,
              reuseExistingServer: false,
              timeout: 120_000,
              env: { CAPACITYLENS_DEV_API_PORT: String(OIDC_API_PORT) },
            },
          ]
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
                env: { CAPACITYLENS_DEV_API_PORT: String(API_PORT) },
              },
              {
                // SMALLSASS_ACCOUNT_MODE=password + a dev-only secret live in the pnpm script; the DB file is
                // recreated on every boot so sign-up state never leaks between runs. NEVER reuse an
                // already-running auth API — the wipe + CAPACITYLENS_CREATE_ADMIN_ADMIN bootstrap only run
                // on a fresh spawn, so an adopted stale server (older env, dirty DB) fails the
                // bootstrap-credential spec with a confusing red (same lesson as the web-port block
                // above and the 2026-07-08 orphaned-:8787 war story in the decisions log).
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
                env: { CAPACITYLENS_DEV_API_PORT: String(AUTH_API_PORT) },
              },
            ],
});
