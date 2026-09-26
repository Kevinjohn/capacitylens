import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { openDb } from "./db";
import { upsertMember } from "./controlTables";

const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));

function boot(overrides: NodeJS.ProcessEnv) {
  const env = {
    ...process.env,
    NODE_ENV: "development",
    CAPACITYLENS_DB: ":memory:",
    CAPACITYLENS_AUDIT: "off",
    SMALLSASS_ACCOUNT_MODE: "off",
    NODE_NO_WARNINGS: "1",
    ...overrides,
  };
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-index-test-"));
  const stdoutPath = join(directory, "stdout.log");
  const stderrPath = join(directory, "stderr.log");
  let stdout = openSync(stdoutPath, "w");
  let stderr = openSync(stderrPath, "w");
  try {
    // tsx may start an esbuild helper. Capture through files so a short-lived descendant cannot
    // keep a stdio pipe open after the entrypoint has already exited with its refusal status.
    const result = spawnSync(process.execPath, [tsxCli, "src/index.ts"], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", stdout, stderr],
      timeout: 10_000,
    });
    closeSync(stdout);
    stdout = -1;
    closeSync(stderr);
    stderr = -1;
    return {
      ...result,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    if (stdout !== -1) closeSync(stdout);
    if (stderr !== -1) closeSync(stderr);
    rmSync(directory, { recursive: true, force: true });
  }
}

async function createSsoCutoverDatabase(): Promise<{ database: string; directory: string }> {
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-sso-cutover-test-"));
  const database = join(directory, "capacitylens.db");
  const db = openDb(database);
  const { auth } = createAuthFromEnvironment(db, {
    SMALLSASS_ACCOUNT_MODE: "password-only",
    SMALLSASS_ACCOUNT_SECRET: "startup-test-secret-0123456789abcdef",
    SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
  });
  if (auth === null) throw new Error("Expected password auth for the startup fixture");
  await runAuthMigrations(auth);
  createSsoIdentity(db);
  createSsoWorkspace(db);
  db.close();
  return { database, directory };
}

function createSsoIdentity(db: ReturnType<typeof openDb>): void {
  const timestamp = "2026-08-07T00:00:00.000Z";
  db.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run("owner-1", "Owner", "owner@example.com", timestamp, timestamp);
  db.prepare(
    `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
     VALUES (?, 'credential', ?, ?, ?, ?)`,
  ).run("credential-1", "owner-1", "owner-1", timestamp, timestamp);
  db.prepare(
    `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("live-session", "2099-01-01T00:00:00.000Z", "live-token", timestamp, timestamp, "owner-1");
  db.prepare(
    `INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "live-reset",
    "reset-password:owner@example.com",
    "reset-value",
    "2099-01-01T00:00:00.000Z",
    timestamp,
    timestamp,
  );
}

function createSsoWorkspace(db: ReturnType<typeof openDb>): void {
  const timestamp = "2026-08-07T00:00:00.000Z";
  db.prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`).run(
    "workspace-1",
    "Wayne Enterprises",
    "#3b82f6",
    timestamp,
    timestamp,
  );
  upsertMember(db, {
    accountId: "workspace-1",
    userId: "owner-1",
    role: "owner",
    status: "active",
    createdAt: timestamp,
  });
}

function buildSsoEnvironment(profile?: string): NodeJS.ProcessEnv {
  const environment = {
    SMALLSASS_ACCOUNT_MODE: "sso-only",
    SMALLSASS_ACCOUNT_SECRET: "startup-test-secret-0123456789abcdef",
    SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
    SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",

    SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
  };
  return profile === undefined ? environment : { ...environment, SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: profile };
}

function assertPreservedSsoState(database: string): void {
  const preserved = openDb(database);
  expect(preserved.prepare(`SELECT id FROM session`).all()).toEqual([{ id: "live-session" }]);
  expect(preserved.prepare(`SELECT id FROM verification`).all()).toEqual([{ id: "live-reset" }]);
  expect(
    preserved.prepare(`SELECT json_extract(payload, '$.action') AS action FROM capacitylens_audit_outbox`).all(),
  ).toEqual([]);
  preserved.close();
}

async function acceptsNamedCompanyConnection(): Promise<void> {
  const { database, directory } = await createSsoCutoverDatabase();
  try {
    const db = openDb(database);
    try {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
          VALUES ('google-owner', 'google', 'google-subject', 'owner-1', ?, ?)`,
      ).run(now, now);
    } finally {
      db.close();
    }
    // Stop after readiness, before listening, using an independently tested backup refusal.
    const backupPath = join(directory, "not-a-backup-directory");
    writeFileSync(backupPath, "filesystem obstruction");
    const result = boot({
      CAPACITYLENS_DB: database,
      CAPACITYLENS_BACKUP_DIR: backupPath,
      ...buildSsoEnvironment("self-hosted-sso-only"),
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("could not be initialized");
    expect(result.stderr).not.toContain("SSO cutover readiness failed");
    const inspected = openDb(database);
    try {
      expect(inspected.prepare("SELECT id FROM session").all()).toEqual([]);
      expect(inspected.prepare("SELECT applicationId FROM capacitylens_sso_cutover_state").all()).toEqual([
        { applicationId: "capacitylens" },
      ]);
    } finally {
      inspected.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Each `boot` is a full entrypoint spawn through tsx with a 10 s budget of its own, and the SSO
// refusal case boots twice. The per-test budget must cover the spawn budgets, not vitest's 5 s
// default: on the shared CI runner the two-boot case already sat near that default before the
// server module graph grew.
// eslint-disable-next-line max-lines-per-function
describe("server entrypoint startup refusals", { timeout: 30_000 }, () => {
  it("refuses a retired account name and identifies its canonical replacement", () => {
    const result = boot({ CAPACITYLENS_AUTH: "password" });

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("CAPACITYLENS_AUTH was removed; use SMALLSASS_ACCOUNT_MODE");
    expect(result.stderr).not.toContain("at resolveAccountEnvironment");
  });

  it("refuses a direct SSO-only flip without a verified provider link", async () => {
    const { database, directory } = await createSsoCutoverDatabase();
    try {
      const result = boot({
        CAPACITYLENS_DB: database,
        ...buildSsoEnvironment("self-hosted-sso-only"),
      });

      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain(
        "owner@example.com has no verified connection to a configured company sign-in provider.",
      );
      expect(result.stderr).not.toContain("at ");

      const repeated = boot({
        CAPACITYLENS_DB: database,
        // The bounded no-profile compatibility posture must not bypass the same SSO interlock.
        ...buildSsoEnvironment(),
      });
      expect(repeated.status, repeated.stderr).toBe(1);
      expect(repeated.stderr).toContain(
        "owner@example.com has no verified connection to a configured company sign-in provider.",
      );
      assertPreservedSsoState(database);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts a named company connection for SSO cutover", acceptsNamedCompanyConnection);

  it("frames a buildApp configuration failure without a raw stack", () => {
    const result = boot({
      CAPACITYLENS_CORS_ORIGIN: "*",
      CAPACITYLENS_BACKUP_DIR: "",
    });

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(
      "capacitylens-server: refusing to start — CORS requires explicit origins when cookie authentication is enabled.",
    );
    expect(result.stderr).not.toContain("at buildApp");
  });

  it("frames a configured backup path that is not a directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "capacitylens-backup-refusal-test-"));
    const backupDir = join(directory, "not-a-directory");
    writeFileSync(backupDir, "filesystem obstruction");
    try {
      const result = boot({
        CAPACITYLENS_CORS_ORIGIN: "http://localhost:5173",
        CAPACITYLENS_BACKUP_DIR: backupDir,
      });

      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain(
        `capacitylens-server: refusing to start — CAPACITYLENS_BACKUP_DIR=${JSON.stringify(backupDir)} could not be initialized:`,
      );
      expect(result.stderr).not.toContain("at startBackups");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
