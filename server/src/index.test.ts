import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { authFromEnv, runAuthMigrations } from "./auth";
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

describe("server entrypoint startup refusals", () => {
  it("refuses a direct SSO-only flip and names an Owner without a verified provider link", async () => {
    const directory = mkdtempSync(join(tmpdir(), "capacitylens-sso-cutover-test-"));
    const database = join(directory, "capacitylens.db");
    const db = openDb(database);
    const password = authFromEnv(db, {
      SMALLSASS_ACCOUNT_MODE: "password",
      SMALLSASS_ACCOUNT_SECRET: "startup-test-secret-0123456789abcdef",
      SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
    });
    await runAuthMigrations(password.auth!);
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
    db.prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`).run(
      "workspace-1",
      "Studio North",
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
    db.close();

    try {
      const result = boot({
        CAPACITYLENS_DB: database,
        SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-sso-only",
        SMALLSASS_ACCOUNT_MODE: "sso",
        SMALLSASS_ACCOUNT_SECRET: "startup-test-secret-0123456789abcdef",
        SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
        SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: "client-id",
        SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: "client-secret",
        SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
        SMALLSASS_ACCOUNT_OIDC_ISSUER: "https://idp.example",
        SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID: "workforce",
      });

      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain("SSO cutover readiness failed");
      expect(result.stderr).toContain("owner@example.com (owner)");
      expect(result.stderr).not.toContain("at ");

      const repeated = boot({
        CAPACITYLENS_DB: database,
        // The bounded no-profile compatibility posture must not bypass the same SSO interlock.
        SMALLSASS_ACCOUNT_MODE: "sso",
        SMALLSASS_ACCOUNT_SECRET: "startup-test-secret-0123456789abcdef",
        SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
        SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: "client-id",
        SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: "client-secret",
        SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
        SMALLSASS_ACCOUNT_OIDC_ISSUER: "https://idp.example",
        SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID: "workforce",
      });
      expect(repeated.status, repeated.stderr).toBe(1);
      expect(repeated.stderr).toContain("SSO cutover readiness failed");

      const preserved = openDb(database);
      expect(preserved.prepare(`SELECT id FROM session`).all()).toEqual([{ id: "live-session" }]);
      expect(preserved.prepare(`SELECT id FROM verification`).all()).toEqual([{ id: "live-reset" }]);
      expect(
        preserved.prepare(`SELECT json_extract(payload, '$.action') AS action FROM capacitylens_audit_outbox`).all(),
      ).toEqual([]);
      preserved.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
