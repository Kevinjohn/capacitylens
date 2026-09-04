import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db";
import { authFromEnv, runAuthMigrations } from "./auth";
import { getAccountCommand, getAccountCommandByIdForReconciliation, reserveAccountCommand } from "./accounts/state";

const serverDirectory = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const fixture = fileURLToPath(new URL("./fixtures/credentialOnboardingCrashFixture.ts", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runCrash(boundary: "after-user" | "after-correlation-commit"): string {
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

// Two of these cases spawn a full tsx child process with a 30 s budget of its own; the per-test
// budget must cover that spawn, not vitest's 5 s default, which the shared CI runner already
// brushes against on a slow run.
describe("credential onboarding crash durability", { timeout: 60_000 }, () => {
  it("rolls back both credential rows when command correlation fails", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, {
      NODE_ENV: "test",
      CAPACITYLENS_AUTH: "password",
      BETTER_AUTH_SECRET: "correlation-test-secret-0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:8787",
      CAPACITYLENS_PASSWORD_BREACH_CHECK: "off",
    });
    await runAuthMigrations(configured.auth!);
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
      configured.auth!.createCredentialUser(
        "correlation@example.com",
        "Correlation Failure",
        "a-valid-correlation-test-password",
        true,
        () => {
          throw new Error("simulated correlation failure");
        },
      ),
    ).rejects.toThrow("simulated correlation failure");
    expect(db.prepare(`SELECT id FROM user`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM account`).all()).toEqual([]);
    expect(
      getAccountCommand(db, "correlation-test", "invite-password-signup", "correlation-idempotency"),
    ).toMatchObject({ status: "pending", targetPrincipalId: null });
    db.close();
  });

  it("rolls back a user when the process exits before its credential link is inserted", () => {
    const db = openDb(runCrash("after-user"));
    expect(db.prepare(`SELECT id FROM user`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM account`).all()).toEqual([]);
    expect((db.prepare(`PRAGMA quick_check`).get() as { quick_check: string }).quick_check).toBe("ok");
    db.close();
  });

  it("recovers the exact principal coordinate when the process exits after identity commit", () => {
    const db = openDb(runCrash("after-correlation-commit"));
    const users = db.prepare(`SELECT id FROM user`).all() as Array<{ id: string }>;
    expect(users).toHaveLength(1);
    expect(db.prepare(`SELECT accountId, providerId, userId FROM account`).all()).toEqual([
      { accountId: users[0].id, providerId: "credential", userId: users[0].id },
    ]);

    const reconciled = getAccountCommandByIdForReconciliation(
      db,
      "crash-fixture",
      "crash-command",
      Date.now() + 20 * 60 * 1000,
    );
    expect(reconciled).toMatchObject({
      status: "reconciliation_required",
      workspaceId: "workspace-1",
      targetPrincipalId: users[0].id,
    });
    expect((db.prepare(`PRAGMA quick_check`).get() as { quick_check: string }).quick_check).toBe("ok");
    db.close();
  });
});
