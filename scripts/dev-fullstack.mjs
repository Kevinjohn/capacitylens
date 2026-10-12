// Start the API and web server together because server-backed app mode needs the Vite proxy's API.

import { parsePort } from "./parsePort.mjs";
import { spawnPnpm } from "./pnpmSpawn.mjs";
import { ports } from "./ports.mjs";
import { portInUse, requireNode24, terminateProcessTrees } from "./devProcesses.mjs";

// Report the Node requirement before the API child fails to load `node:sqlite`.
requireNode24(
  (version) =>
    `dev: full-stack dev needs Node 24+ — found ${version}. The API uses Node's ` +
    `built-in node:sqlite (see .nvmrc). Fix: \`nvm use\`, or install Node 24+ from ` +
    `https://nodejs.org. No Node 24? \`pnpm run dev:demo\` runs the backend-free demo build.`,
);

// Use the configured API port, defaulting to this lane's port, for the server and Vite proxy.
const lanePorts = ports();
const API_PORT = parsePort(process.env.CAPACITYLENS_DEV_API_PORT, lanePorts.dbApi, "CAPACITYLENS_DEV_API_PORT");
const WEB_PORT = lanePorts.web;

// Check both ports before starting either child so a collision cannot leave a half-started stack.
if (await portInUse(API_PORT)) {
  console.error(
    `dev: port ${API_PORT} is already in use — the API can't start. Stop whatever holds it ` +
      `(another \`pnpm run dev\`, a stray capacitylens-server), or set CAPACITYLENS_DEV_API_PORT ` +
      `to a free port. Not starting the web server to avoid a half-up stack.`,
  );
  process.exit(1);
}

if (await portInUse(WEB_PORT)) {
  console.error(
    `dev: port ${WEB_PORT} is already in use — the Vite web server can't start (strictPort). Stop ` +
      `whatever holds it (for example another \`pnpm run dev\` or \`pnpm run dev:demo\`). ` +
      `Not starting the API server to avoid a half-up stack.`,
  );
  process.exit(1);
}

const children = [];
let shuttingDown = false;

// Stop both detached child process groups so neither server outlives the other.
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await terminateProcessTrees(children);
  } finally {
    process.exit(code);
  }
}

function start(label, args, env) {
  const child = spawnPnpm(args, {
    // Ignore stdin (inherit stdout/stderr): with detached:true the child is outside the terminal's
    // foreground group, so handing it the TTY stdin risks SIGTTIN and trips Vite's stdin-EOF→SIGTERM
    // shortcut handler. Neither tsx-watch nor Vite needs interactive stdin under this launcher.
    stdio: ["ignore", "inherit", "inherit"],
    // Give each child its own process group so shutdown can stop both process trees.
    detached: true,
    env: { ...process.env, ...env },
  });
  children.push(child);
  // Either child exiting tears the whole stack down. A dead API or a dead web server both mean
  // dev is broken, and we never leave the survivor orphaned.
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`dev: ${label} exited (${signal ? `signal ${signal}` : `code ${code}`}); shutting down.`);
    void shutdown(code ?? 1);
  });
  child.on("error", (err) => {
    if (shuttingDown) return;
    console.error(`dev: failed to launch ${label}: ${err.message}`);
    void shutdown(1);
  });
  return child;
}

// Demo seeding creates two companies, so local development also enables multi-account creation.
start("api", ["--filter", "capacitylens-server", "run", "dev"], {
  PORT: String(API_PORT),
  CAPACITYLENS_SEED_DEMO: "1",
  CAPACITYLENS_MULTI_ACCOUNT: "1",
});
start("web", ["run", "dev:web"], { CAPACITYLENS_DEV_API_PORT: String(API_PORT) });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown(0));
}
