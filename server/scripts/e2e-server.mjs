// Boot one of the E2E API servers on this run's lane ports.
//
// The auth flavour's environment used to live inline in server/package.json. It cannot stay there
// now: PORT, SMALLSASS_ACCOUNT_PUBLIC_URL and CAPACITYLENS_CORS_ORIGIN all carry a port, and they
// have to move together. A lane-shifted server with a lane-0 CORS origin starts perfectly and then
// fails every browser request, which is a far worse failure than not starting at all.
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mirrorChildExit } from "../../scripts/dev-processes.mjs";
import { ports } from "../../scripts/ports.mjs";
import { startE2eMailbox } from "./e2e-mailbox.mjs";

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
      SMALLSASS_ACCOUNT_MODE: "password-only",
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
let mailbox;
if (flavour === "auth") {
  const mailboxPath = fileURLToPath(new URL("../.auth-e2e-mailbox.jsonl", import.meta.url));
  writeFileSync(mailboxPath, "");
  mailbox = await startE2eMailbox({ port: lanePorts.authMail, mailboxPath });
  Object.assign(env, {
    SMALLSASS_ACCOUNT_MAIL_HOST: "127.0.0.1",
    SMALLSASS_ACCOUNT_MAIL_PORT: String(lanePorts.authMail),
    SMALLSASS_ACCOUNT_MAIL_USER: "e2e-mail",
    SMALLSASS_ACCOUNT_MAIL_PASSWORD: "e2e-mail-password",
    SMALLSASS_ACCOUNT_MAIL_FROM: "verify@capacitylens.dev",
    NODE_EXTRA_CA_CERTS: mailbox.certPath,
  });
}

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
child.once("exit", () => mailbox?.close());

mirrorChildExit(child, { label: "e2e-server: tsx" });
