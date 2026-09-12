import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAccessLabEnv } from "./access-lab-env.mjs";
import { spawnPnpm } from "./pnpm-spawn.mjs";
import { acquireExclusiveFile, portInUse, requireNode24, terminateProcessTrees } from "./dev-processes.mjs";
import { FIXED_PORTS_LOCK_FILE, OIDC_FIXED_PORTS } from "./ports.mjs";

requireNode24((version) => `dev:access needs Node 24+ — found ${version}. Run \`nvm use\` and retry.`);

// The access lab shares the OIDC flavour's fixed ports, which are deliberately outside the lane
// system (see scripts/ports.mjs). Its own exclusive lock below is what keeps it single-flight.
const API_PORT = OIDC_FIXED_PORTS.oidcApi;
const WEB_PORT = OIDC_FIXED_PORTS.oidcWeb;
const dbUrl = new URL("../server/.access-lab.db", import.meta.url);
const dbPath = fileURLToPath(dbUrl);
const ownershipPath = fileURLToPath(new URL(`../${FIXED_PORTS_LOCK_FILE}`, import.meta.url));
let releaseOwnership;
try {
  releaseOwnership = acquireExclusiveFile(ownershipPath);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.error(
    "dev:access shares fixed ports with `pnpm run e2e:oidc`, and one of them is already running. " +
      "Stop it and retry — these two are deliberately single-flight, outside the port-lane system.",
  );
  process.exit(1);
}
process.once("exit", releaseOwnership);

function exitSetup(code) {
  releaseOwnership();
  process.exit(code);
}

const children = [];
let shuttingDown = false;

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await terminateProcessTrees(children);
  } finally {
    releaseOwnership();
    process.exit(code);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown(0));

for (const [label, port] of [
  ["API", API_PORT],
  ["web", WEB_PORT],
]) {
  if (await portInUse(port)) {
    console.error(`dev:access ${label} port ${port} is already in use. Stop the existing process and retry.`);
    exitSetup(1);
  }
}

for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });

// Keep process essentials such as PATH, but do not let an operator's deployment configuration leak
// into this fixed-credential local lab. In particular, an inherited 0.0.0.0 host, TLS/auth provider,
// reset route, demo seed, or Vite API override could expose it or make the browser talk elsewhere.
const commonEnv = buildAccessLabEnv(process.env, { apiPort: API_PORT, webPort: WEB_PORT });

const setup = spawnPnpm(["--filter", "capacitylens-server", "exec", "tsx", "scripts/setup-access-lab.ts"], {
  stdio: ["ignore", "inherit", "inherit"],
  detached: true,
  env: commonEnv,
});
children.push(setup);
const waitForExit = (child) =>
  new Promise((resolve, reject) => {
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
const setupCode = await waitForExit(setup);
children.splice(children.indexOf(setup), 1);
if (setupCode !== 0) exitSetup(setupCode);

const compile = spawnPnpm(["run", "paraglide:compile"], {
  stdio: ["ignore", "inherit", "inherit"],
  detached: true,
  env: commonEnv,
});
children.push(compile);
const compileCode = await waitForExit(compile);
children.splice(children.indexOf(compile), 1);
if (compileCode !== 0) exitSetup(compileCode);

function start(label, args, env = {}) {
  const child = spawnPnpm(args, {
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
    env: { ...commonEnv, ...env },
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`dev:access ${label} exited (${signal ? `signal ${signal}` : `code ${code}`}).`);
      void shutdown(code ?? 1);
    }
  });
  child.on("error", (error) => {
    console.error(`dev:access failed to launch ${label}: ${error.message}`);
    void shutdown(1);
  });
}

console.log(`Access lab: http://127.0.0.1:${WEB_PORT}`);
console.log("Password for every persona: access-lab-password-2026");
start("api", ["--filter", "capacitylens-server", "run", "start"]);
start("web", ["exec", "vite", "--port", String(WEB_PORT)], {
  CAPACITYLENS_DEV_API_PORT: String(API_PORT),
});
