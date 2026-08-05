import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp as buildAppRaw } from "./app";
import { openDb as openDbRaw, openDbConnection, insertAll, type Db } from "./db";
import { upsertMember } from "./controlTables";
import { authFromEnv, runAuthMigrations } from "./auth";
import { isAuditEntry } from "./auditOutbox";
import { PASSWORD_ENV, call, signUp, registerServerFixtureCleanup } from "./testHelpers";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { resetOwnerPassword } from "./resetOwnerPassword";

// Sole-Owner credential recovery (family playbook _sole-owner-recovery-playbook-2026-08-05.md).
// The tool under test is an operator CLI ceremony, so every fixture is a real on-disk database:
// the interlock is actual SQLite locking, and the happy path proves the minted link round-trips
// through the ordinary Better Auth reset page semantics (single-use, session revocation).

const TS = "2026-01-01T00:00:00.000Z";
const OWNER_EMAIL = "owner@capacitylens.dev";
const ADMIN_EMAIL = "admin@capacitylens.dev";
const PASSWORD = "password-123456";
const NEW_PASSWORD = "recovered-password-654321";

const fixtures = registerServerFixtureCleanup();
const openDb = (...args: Parameters<typeof openDbRaw>) => fixtures.trackDb(openDbRaw(...args));
const buildApp = (...args: Parameters<typeof buildAppRaw>) => fixtures.trackApp(buildAppRaw(...args));

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "owner-recovery-"));
  tempDirs.push(dir);
  return join(dir, "capacitylens.db");
}

function seedAccount(db: Db, id: string): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>;
  d.accounts = [{ id, name: `Studio ${id}`, color: "#3b82f6", createdAt: TS, updatedAt: TS }];
  insertAll(db, d as unknown as AppData);
}

/** A migrated password-mode instance whose server has already exited: the tool's precondition. */
async function seededInstance(opts: { withAdmin?: boolean; ownerStatus?: string } = {}): Promise<{
  databasePath: string;
  ownerUserId: string;
}> {
  const databasePath = tempDbPath();
  const db = openDb(databasePath);
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV);
  await runAuthMigrations(auth!);
  const app: FastifyInstance = buildApp(db, { authMode: mode, auth });
  seedAccount(db, "a1");
  const owner = await signUp(app, OWNER_EMAIL);
  upsertMember(db, {
    accountId: "a1",
    userId: owner.userId,
    role: "owner",
    status: "active",
    createdAt: TS,
  });
  if (opts.withAdmin) {
    const admin = await signUp(app, ADMIN_EMAIL);
    upsertMember(db, { accountId: "a1", userId: admin.userId, role: "admin", status: "active", createdAt: TS });
  }
  if (opts.ownerStatus && opts.ownerStatus !== "active") {
    // Legacy control rows may carry a non-active status; recovery must treat them as absence.
    db.prepare(`UPDATE account_members SET status = ? WHERE userId = ?`).run(opts.ownerStatus, owner.userId);
  }
  await app.close();
  db.close();
  return { databasePath, ownerUserId: owner.userId };
}

const run = (databasePath: string, overrides: Partial<Parameters<typeof resetOwnerPassword>[0]> = {}) =>
  resetOwnerPassword({
    databasePath,
    email: OWNER_EMAIL,
    confirmServerStopped: true,
    env: PASSWORD_ENV,
    ...overrides,
  });

describe("resetOwnerPassword guards", () => {
  it("refuses without --confirm-server-stopped", async () => {
    const { databasePath } = await seededInstance();
    await expect(run(databasePath, { confirmServerStopped: false })).rejects.toThrow(/--confirm-server-stopped/);
  });

  it("refuses :memory: and missing database files", async () => {
    await expect(run(":memory:")).rejects.toThrow(/existing on-disk/);
    await expect(run(join(tmpdir(), "does-not-exist", "missing.db"))).rejects.toThrow(/existing on-disk/);
  });

  it("refuses a malformed address (isAccountEmail, not a substring check)", async () => {
    const { databasePath } = await seededInstance();
    await expect(run(databasePath, { email: "owner@@capacitylens.dev" })).rejects.toThrow(/not a valid account address/);
  });

  it("refuses sso and off modes and an unset public URL, naming canonical keys", async () => {
    const { databasePath } = await seededInstance();
    await expect(run(databasePath, { env: { ...PASSWORD_ENV, CAPACITYLENS_AUTH: "sso" } })).rejects.toThrow(
      /SMALLSASS_ACCOUNT_MODE must be password/,
    );
    await expect(run(databasePath, { env: { ...PASSWORD_ENV, CAPACITYLENS_AUTH: "off" } })).rejects.toThrow(
      /SMALLSASS_ACCOUNT_MODE must be password/,
    );
    await expect(run(databasePath, { env: { ...PASSWORD_ENV, BETTER_AUTH_URL: undefined } })).rejects.toThrow(
      /SMALLSASS_ACCOUNT_PUBLIC_URL/,
    );
  });

  it("refuses while another connection holds the database, then proceeds once released", async () => {
    const { databasePath } = await seededInstance();
    const holder = openDbConnection(databasePath);
    try {
      holder.exec("BEGIN IMMEDIATE");
      await expect(run(databasePath)).rejects.toThrow(/Another process holds this database/);
      holder.exec("COMMIT");
    } finally {
      holder.close();
    }
    await expect(run(databasePath)).resolves.toMatchObject({ accountIds: ["a1"] });
  });

  it("refuses a database that is not migrated to the current schema", async () => {
    const databasePath = tempDbPath();
    writeFileSync(databasePath, ""); // a zero-byte file is a valid, entirely unmigrated SQLite database
    await expect(run(databasePath)).rejects.toThrow(/is not current/);
  });

  it("refuses when no identity matches the address", async () => {
    const { databasePath } = await seededInstance();
    await expect(run(databasePath, { email: "nobody@capacitylens.dev" })).rejects.toThrow(/No identity matches/);
  });

  it("refuses an Admin target: only the sole active Owner is beyond in-product help", async () => {
    const { databasePath } = await seededInstance({ withAdmin: true });
    await expect(run(databasePath, { email: ADMIN_EMAIL })).rejects.toThrow(/not the sole active Owner/);
  });

  it("refuses a legacy non-active Owner row: it confers no authority and is treated as absence", async () => {
    const { databasePath } = await seededInstance({ ownerStatus: "suspended" });
    await expect(run(databasePath)).rejects.toThrow(/not the sole active Owner/);
  });
});

describe("resetOwnerPassword ceremony", () => {
  it("mints a link that round-trips the ordinary reset flow: single-use, old password dead, audit has digest not token", async () => {
    const { databasePath, ownerUserId } = await seededInstance();

    // Mixed-case, padded input must resolve through normalizeAccountEmail to the stored identity.
    const result = await run(databasePath, { email: "  Owner@CapacityLens.DEV " });
    expect(result.email).toBe(OWNER_EMAIL);
    expect(result.userId).toBe(ownerUserId);
    expect(result.accountIds).toEqual(["a1"]);
    expect(result.link.startsWith("http://localhost:8787/reset-password/")).toBe(true);
    const token = decodeURIComponent(result.link.split("/reset-password/")[1]!);
    expect(token.length).toBeGreaterThan(0);

    // The audit outbox row is a valid account event carrying the ceremony digest and never the token.
    const inspect = openDbConnection(databasePath);
    fixtures.trackDb(inspect);
    const rows = inspect
      .prepare(`SELECT id, payload FROM capacitylens_audit_outbox`)
      .all() as Array<{ id: string; payload: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(result.auditId);
    expect(rows[0]!.payload).not.toContain(token);
    const event = JSON.parse(rows[0]!.payload) as Record<string, unknown>;
    expect(isAuditEntry(event)).toBe(true);
    expect(event.action).toBe("identity.owner_recovery_issued");
    expect(event.actorPrincipalId).toBeNull();
    expect(event.targetPrincipalId).toBe(ownerUserId);
    expect(event.changedFields).toContain(`ceremony:${result.ceremonyId}`);
    inspect.close();

    // Redeem through the real server the Owner would start afterwards.
    const db = openDb(databasePath);
    const { mode, auth } = authFromEnv(db, PASSWORD_ENV);
    const app = buildApp(db, { authMode: mode, auth });
    const redeem = await call(app, {
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: NEW_PASSWORD, token },
    });
    expect(redeem.statusCode).toBe(200);
    const replay = await call(app, {
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: "attacker-password-999999", token },
    });
    expect(replay.statusCode).not.toBe(200);
    const oldSignIn = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: OWNER_EMAIL, password: PASSWORD },
    });
    expect(oldSignIn.statusCode).not.toBe(200);
    const newSignIn = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: OWNER_EMAIL, password: NEW_PASSWORD },
    });
    expect(newSignIn.statusCode).toBe(200);
  });

  it("fails closed: a post-mint audit failure revokes the freshly minted ceremony", async () => {
    const { databasePath, ownerUserId } = await seededInstance();
    const saboteur = openDbConnection(databasePath);
    saboteur.exec(
      `CREATE TRIGGER block_audit BEFORE INSERT ON capacitylens_audit_outbox
       BEGIN SELECT RAISE(ABORT, 'audit sink unavailable'); END;`,
    );
    saboteur.close();

    await expect(run(databasePath)).rejects.toThrow(/reset ceremony has been revoked/);

    const inspect = openDbConnection(databasePath);
    fixtures.trackDb(inspect);
    const ceremonies = inspect.prepare(`SELECT value FROM verification WHERE value = ?`).all(ownerUserId);
    expect(ceremonies).toHaveLength(0);
    const outbox = inspect.prepare(`SELECT COUNT(*) AS n FROM capacitylens_audit_outbox`).get() as { n: number };
    expect(outbox.n).toBe(0);
    inspect.close();
  });
});
