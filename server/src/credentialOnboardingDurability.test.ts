import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, type Db } from "./db";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import type { Auth } from "./authConfig/authTypes";
import { getAccountCommand, getAccountCommandByIdForReconciliation, reserveAccountCommand } from "./accounts/state";

const serverDirectory = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const fixture = fileURLToPath(new URL("./fixtures/credentialOnboardingCrashFixture.ts", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createPasswordAuth(db: Db): Auth {
  const configured = createAuthFromEnvironment(db, {
    NODE_ENV: "test",
    CAPACITYLENS_AUTH: "password",
    BETTER_AUTH_SECRET: "correlation-test-secret-0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:8787",
    CAPACITYLENS_PASSWORD_BREACH_CHECK: "off",
  });
  const auth = configured.auth;
  if (!auth) throw new Error("Expected password authentication to be configured.");
  return auth;
}

function createCrashDatabasePath(boundary: "after-user" | "after-correlation-commit"): string {
  const directory = mkdtempSync(join(tmpdir(), `capacitylens-credential-${boundary}-`));
  temporaryDirectories.push(directory);
  const dbPath = join(directory, "capacitylens.db");
  const result = spawnSync(process.execPath, ["--import", "tsx", fixture, dbPath, boundary], {
    cwd: serverDirectory,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, NODE_ENV: "test" },
  });
  expect(result.status, result.stderr || result.stdout).toBe(86);
  return dbPath;
}

function readQuickCheck(db: Db): string {
  const row = db.prepare(`PRAGMA quick_check`).get();
  if (!row || typeof row.quick_check !== "string") throw new Error("Expected SQLite quick_check output.");
  return row.quick_check;
}

function readPrincipalIds(db: Db): Array<{ id: string }> {
  return db
    .prepare(`SELECT id FROM user`)
    .all()
    .map((row) => {
      if (typeof row.id !== "string") throw new Error("Expected a credential principal id.");
      return { id: row.id };
    });
}

function registerCorrelationRollbackTest(): void {
  it("rolls back both credential rows when command correlation fails", async () => {
    const db = openDb(":memory:");
    const auth = createPasswordAuth(db);
    await runAuthMigrations(auth);
    reserveAccountCommand(db, {
      applicationId: "correlation-test",
      operation: "invite-password-signup",
      idempotencyKey: "correlation-idempotency",
      commandId: "correlation-command",
      actorPrincipalId: null,
      workspaceId: "workspace-1",
      payloadHash: "b".repeat(64),
    });

    await expect(
      auth.createCredentialUser({
        email: "correlation@example.com",
        name: "Correlation Failure",
        password: "a-valid-correlation-test-password",
        emailVerified: true,
        correlateInTransaction: () => {
          throw new Error("simulated correlation failure");
        },
      }),
    ).rejects.toThrow("simulated correlation failure");
    expect(db.prepare(`SELECT id FROM user`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM account`).all()).toEqual([]);
    expect(
      getAccountCommand({
        db,
        applicationId: "correlation-test",
        operation: "invite-password-signup",
        idempotencyKey: "correlation-idempotency",
      }),
    ).toMatchObject({ status: "pending", targetPrincipalId: null });
    db.close();
  });
}

function registerCrashRecoveryTests(): void {
  it("rolls back a user when the process exits before its credential link is inserted", () => {
    const db = openDb(createCrashDatabasePath("after-user"));
    expect(db.prepare(`SELECT id FROM user`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM account`).all()).toEqual([]);
    expect(readQuickCheck(db)).toBe("ok");
    db.close();
  });

  it("recovers the exact principal coordinate when the process exits after identity commit", () => {
    const db = openDb(createCrashDatabasePath("after-correlation-commit"));
    const users = readPrincipalIds(db);
    expect(users).toHaveLength(1);
    const user = users[0];
    if (!user) throw new Error("Expected one recovered credential principal.");
    expect(db.prepare(`SELECT accountId, providerId, userId FROM account`).all()).toEqual([
      { accountId: user.id, providerId: "credential", userId: user.id },
    ]);

    const reconciled = getAccountCommandByIdForReconciliation({
      db,
      applicationId: "crash-fixture",
      commandId: "crash-command",
      now: Date.now() + 20 * 60 * 1000,
    });
    expect(reconciled).toMatchObject({
      status: "reconciliation_required",
      workspaceId: "workspace-1",
      targetPrincipalId: user.id,
    });
    expect(readQuickCheck(db)).toBe("ok");
    db.close();
  });
}

// Two of these cases spawn a full tsx child process with a 30 s budget of its own; the per-test
// budget must cover that spawn, not vitest's 5 s limit, which the shared CI runner already brushes
// against on a slow run.
describe("credential onboarding crash durability", { timeout: 60_000 }, () => {
  registerCorrelationRollbackTest();
  registerCrashRecoveryTests();
});
