import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authFromEnv, runAuthMigrations } from "./auth";
import { DATABASE_MIGRATION_TABLE, openDb } from "./db";
import { repairSsoCutover } from "./cutoverRepair";
import { inspectSsoCutoverPreflight } from "./cutoverPreflight";

const env = {
  SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-mixed",
  SMALLSASS_ACCOUNT_MODE: "password",
  SMALLSASS_ACCOUNT_SECRET: "cutover-repair-secret-0123456789abcdef",
  SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: "client-id",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: "client-secret",
  SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
  SMALLSASS_ACCOUNT_OIDC_ISSUER: "https://idp.example",
  SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID: "workforce",
};

const timestamp = "2026-08-07T00:00:00.000Z";
let directory: string | null = null;

async function database() {
  directory = mkdtempSync(join(tmpdir(), "capacitylens-cutover-repair-"));
  const path = join(directory, "capacitylens.db");
  const db = openDb(path);
  const configured = authFromEnv(db, env);
  await runAuthMigrations(configured.auth!);
  return { path, db };
}

function insertUser(db: ReturnType<typeof openDb>, id: string, email: string) {
  db.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(id, id, email, timestamp, timestamp);
}

function insertAccount(
  db: ReturnType<typeof openDb>,
  id: string,
  providerId: string,
  subject: string,
  principalId: string,
) {
  db.prepare(
    `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, providerId, subject, principalId, timestamp, timestamp);
}

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
});

describe("stopped-server SSO cutover repair", () => {
  it("removes exactly the named duplicate subject link so v25 can migrate safely", async () => {
    const prepared = await database();
    insertUser(prepared.db, "wrong-principal", "wrong@example.com");
    insertUser(prepared.db, "right-principal", "right@example.com");
    insertAccount(prepared.db, "wrong-link", "workforce", "duplicate-subject", "wrong-principal");
    insertAccount(prepared.db, "wrong-credential", "credential", "wrong-principal", "wrong-principal");
    prepared.db.prepare(`UPDATE account SET password = ? WHERE id = ?`).run("stored-password-hash", "wrong-credential");
    // Simulate the pre-v25 race state: v24 had no composite uniqueness backstop.
    prepared.db.exec(`
      DROP INDEX idx_account_provider_subject_unique;
      DROP TRIGGER capacitylens_observe_federated_account;
      DELETE FROM capacitylens_federated_link_observations;
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 25;
      PRAGMA user_version = 24;
    `);
    insertAccount(prepared.db, "right-link", "workforce", "duplicate-subject", "right-principal");
    prepared.db.close();

    await expect(
      repairSsoCutover({
        databasePath: prepared.path,
        confirmServerStopped: true,
        operation: {
          kind: "remove-provider-link",
          email: "wrong@example.com",
          providerId: "workforce",
          subject: "duplicate-subject",
        },
        env,
      }),
    ).resolves.toMatchObject({
      operation: "remove-provider-link",
      principalId: "wrong-principal",
      providerId: "workforce",
      subject: "duplicate-subject",
    });

    const verified = openDb(prepared.path);
    expect(verified.prepare(`SELECT id, userId FROM account WHERE providerId = 'workforce'`).all()).toEqual([
      { id: "right-link", userId: "right-principal" },
    ]);
    expect(verified.prepare(`PRAGMA user_version`).get()).toEqual({ user_version: 27 });
    verified.close();
  });

  it.each([
    ["credential-only", true],
    ["providerless", false],
  ])("deprovisions a %s principal with no active membership", async (_description, withCredential) => {
    const prepared = await database();
    insertUser(prepared.db, "orphan-principal", "former@example.com");
    if (withCredential) {
      insertAccount(prepared.db, "credential-link", "credential", "orphan-principal", "orphan-principal");
    }
    prepared.db.close();

    await expect(
      repairSsoCutover({
        databasePath: prepared.path,
        confirmServerStopped: true,
        operation: { kind: "deprovision-credential-orphan", email: "former@example.com" },
        env,
      }),
    ).resolves.toMatchObject({
      operation: "deprovision-credential-orphan",
      principalId: "orphan-principal",
      email: "former@example.com",
    });

    const verified = openDb(prepared.path);
    expect(verified.prepare(`SELECT id FROM user WHERE id = 'orphan-principal'`).get()).toBeUndefined();
    expect(verified.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toHaveLength(1);
    verified.close();
  });

  it("removes an exact alternative-provider link", async () => {
    const prepared = await database();
    insertUser(prepared.db, "principal-1", "owner@example.com");
    insertAccount(prepared.db, "credential-link", "credential", "principal-1", "principal-1");
    prepared.db.prepare(`UPDATE account SET password = ? WHERE id = ?`).run("stored-password-hash", "credential-link");
    insertAccount(prepared.db, "github-link", "github", "github-subject", "principal-1");
    prepared.db.close();

    await expect(
      repairSsoCutover({
        databasePath: prepared.path,
        confirmServerStopped: true,
        operation: {
          kind: "remove-provider-link",
          email: "owner@example.com",
          providerId: "github",
          subject: "github-subject",
        },
        env,
      }),
    ).resolves.toMatchObject({ providerId: "github", subject: "github-subject" });

    const verified = openDb(prepared.path);
    expect(verified.prepare(`SELECT id FROM account WHERE providerId = 'github'`).all()).toEqual([]);
    expect(verified.prepare(`SELECT id FROM account WHERE providerId = 'credential'`).all()).toEqual([
      { id: "credential-link" },
    ]);
    verified.close();
  });

  it("repairs one exact row from a legacy multi-link state", async () => {
    const prepared = await database();
    insertUser(prepared.db, "principal-1", "owner@example.com");
    insertAccount(prepared.db, "credential-link", "credential", "principal-1", "principal-1");
    prepared.db.prepare(`UPDATE account SET password = ? WHERE id = ?`).run("stored-password-hash", "credential-link");
    prepared.db.exec(`
      DROP INDEX idx_account_principal_provider_unique;
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 25;
      PRAGMA user_version = 24;
    `);
    insertAccount(prepared.db, "keep-link", "workforce", "subject-correct", "principal-1");
    insertAccount(prepared.db, "wrong-link", "workforce", "subject-wrong", "principal-1");
    prepared.db.close();

    await expect(
      repairSsoCutover({
        databasePath: prepared.path,
        confirmServerStopped: true,
        operation: {
          kind: "remove-provider-link",
          email: "owner@example.com",
          providerId: "workforce",
          subject: "subject-wrong",
        },
        env,
      }),
    ).resolves.toMatchObject({ providerId: "workforce", subject: "subject-wrong" });

    const verified = openDb(prepared.path);
    expect(verified.prepare(`SELECT id, accountId FROM account WHERE providerId = 'workforce'`).all()).toEqual([
      { id: "keep-link", accountId: "subject-correct" },
    ]);
    verified.close();
  });

  it("assigns an active member as Owner in an ownerless workspace", async () => {
    const prepared = await database();
    insertUser(prepared.db, "principal-1", "admin@example.com");
    insertAccount(prepared.db, "credential-link", "credential", "principal-1", "principal-1");
    prepared.db
      .prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`)
      .run("workspace-1", "Studio", "#3b82f6", timestamp, timestamp);
    prepared.db
      .prepare(
        `INSERT INTO account_members (accountId, userId, role, status, createdAt)
         VALUES (?, ?, 'admin', 'active', ?)`,
      )
      .run("workspace-1", "principal-1", timestamp);
    prepared.db.close();

    await expect(
      repairSsoCutover({
        databasePath: prepared.path,
        confirmServerStopped: true,
        operation: { kind: "assign-workspace-owner", workspaceId: "workspace-1", email: "admin@example.com" },
        env,
      }),
    ).resolves.toMatchObject({ operation: "assign-workspace-owner", principalId: "principal-1" });

    const verified = openDb(prepared.path);
    expect(verified.prepare(`SELECT role FROM account_members WHERE accountId = ?`).get("workspace-1")).toEqual({
      role: "owner",
    });
    verified.close();
  });

  it("erases only a workspace with no active members", async () => {
    const prepared = await database();
    prepared.db
      .prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`)
      .run("workspace-empty", "Empty", "#3b82f6", timestamp, timestamp);
    prepared.db.close();

    await expect(
      repairSsoCutover({
        databasePath: prepared.path,
        confirmServerStopped: true,
        operation: { kind: "erase-empty-workspace", workspaceId: "workspace-empty" },
        env,
      }),
    ).resolves.toMatchObject({ operation: "erase-empty-workspace", principalId: null });

    const verified = openDb(prepared.path);
    expect(verified.prepare(`SELECT id FROM accounts WHERE id = 'workspace-empty'`).get()).toBeUndefined();
    expect(
      verified.prepare(`SELECT json_extract(payload, '$.action') AS action FROM capacitylens_audit_outbox`).all(),
    ).toEqual([{ action: "workspace.erased" }]);
    verified.close();
  });

  it("refuses a credential principal that still belongs to a workspace", async () => {
    const prepared = await database();
    insertUser(prepared.db, "member-principal", "member@example.com");
    insertAccount(prepared.db, "credential-link", "credential", "member-principal", "member-principal");
    prepared.db
      .prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`)
      .run("workspace-1", "Studio", "#3b82f6", timestamp, timestamp);
    prepared.db
      .prepare(
        `INSERT INTO account_members (accountId, userId, role, status, createdAt) VALUES (?, ?, 'owner', 'active', ?)`,
      )
      .run("workspace-1", "member-principal", timestamp);
    prepared.db.close();

    await expect(
      repairSsoCutover({
        databasePath: prepared.path,
        confirmServerStopped: true,
        operation: { kind: "deprovision-credential-orphan", email: "member@example.com" },
        env,
      }),
    ).rejects.toThrow(/not a providerless or credential-only principal with zero active workspace memberships/i);
  });
});

describe("SSO cutover preflight prerequisites", () => {
  it("refuses when Better Auth still plans schema work", async () => {
    const prepared = await database();
    prepared.db.exec(`DROP TABLE verification`);

    await expect(inspectSsoCutoverPreflight(prepared.db, env)).rejects.toThrow(/Better Auth schema is not current/i);
    prepared.db.close();
  });

  it("refuses when the persisted provider binding disagrees with configuration", async () => {
    const prepared = await database();
    prepared.db
      .prepare(`UPDATE account_federated_provider_bindings SET issuer = ? WHERE providerId = ?`)
      .run("https://wrong-idp.example", "workforce");

    await expect(inspectSsoCutoverPreflight(prepared.db, env)).rejects.toThrow(/provider binding does not match/i);
    prepared.db.close();
  });
});
