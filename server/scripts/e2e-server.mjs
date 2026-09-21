// Boot one of the E2E API servers on this run's lane ports.
//
// The auth flavour's environment used to live inline in server/package.json. It cannot stay there
// now: PORT, SMALLSASS_ACCOUNT_PUBLIC_URL and CAPACITYLENS_CORS_ORIGIN all carry a port, and they
// have to move together. A lane-shifted server with a lane-0 CORS origin starts perfectly and then
// fails every browser request, which is a far worse failure than not starting at all.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ports } from "../../scripts/ports.mjs";

const flavour = process.argv[2];
const lanePorts = ports();

// The database files are relative to server/, so they are already per-worktree; only the ports and
// the URLs built from them need the lane.
const FLAVOURS = {
  db: () => ({
    database: ".e2e.db",
    wipe: false,
    env: { CAPACITYLENS_ALLOW_RESET: "1", PORT: String(lanePorts.dbApi) },
  }),
  auth: () => ({
    database: ".auth-e2e.db",
    wipe: true,
    env: {
      PORT: String(lanePorts.authApi),
      SMALLSASS_ACCOUNT_MODE: "password",
      CAPACITYLENS_CREATE_ADMIN_ADMIN: "1",
      CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: "auth-e2e-password-2026",
      SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK: "off",
      SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: "1",
      CAPACITYLENS_MULTI_ACCOUNT: "1",
      CAPACITYLENS_BOOTSTRAP_TOKEN: "auth-e2e-bootstrap-token-0123456789abcdef",
      SMALLSASS_ACCOUNT_SECRET: "capacitylens-auth-e2e-secret-0123456789abcdef",
      SMALLSASS_ACCOUNT_PUBLIC_URL: `http://localhost:${lanePorts.authApi}`,
      CAPACITYLENS_CORS_ORIGIN: `http://localhost:${lanePorts.authWeb},http://127.0.0.1:${lanePorts.authWeb}`,
    },
  }),
};

if (!Object.hasOwn(FLAVOURS, flavour)) {
  console.error(
    `e2e-server: expected a flavour of ${Object.keys(FLAVOURS).join(" or ")}; received ${JSON.stringify(flavour)}.`,
  );
  process.exit(2);
}

const { database, wipe, env } = FLAVOURS[flavour]();
const serverDirectory = fileURLToPath(new URL("../", import.meta.url));

// A fresh database per boot so sign-up state never leaks between runs; the bootstrap credential
// only exists on a clean one.
if (wipe)
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(new URL(`../${database}${suffix}`, import.meta.url), { force: true });

const child = spawn("tsx", ["src/index.ts"], {
  cwd: serverDirectory,
  stdio: "inherit",
  env: { ...process.env, CAPACITYLENS_DB: database, ...env },
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(`e2e-server: could not start tsx: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
