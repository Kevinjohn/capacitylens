import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type { ActorContext } from "@capacitylens/shared/account/types";
import { createInvite, getInvite, upsertMember } from "../controlTables";
import { openDb, insertRow, type Db } from "../db";
import { KeyedOperationLock } from "./KeyedOperationLock";
import { readMemberSignInTrackingSnapshot, setMemberSignInTracking } from "./memberSignInTracking";
import { hasLivePreauthorizedInvitation, createSqliteAccountAdminPort } from "./sqliteAccountAdminPort";
import { WRITE_ONCE_SECRET_REPLAY_WINDOW_MS } from "./WriteOnceSecretReplay";

const actor: ActorContext = {
  principalId: "owner-1",
  sessionId: "session-1",
  assurance: "mfa",
  fresh: true,
  mfaSatisfied: true,
};

const command = { commandId: "command-1", idempotencyKey: "idempotency-1" };

function seedMfaAuditFixture(db: Db): {
  auditEvents: AccountAuditEvent[];
  port: ReturnType<typeof createSqliteAccountAdminPort>;
} {
  insertRow(db, "accounts", {
    id: "workspace-1",
    name: "Workspace",
    color: "#6366f1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  upsertMember(db, {
    accountId: "workspace-1",
    userId: actor.principalId,
    role: "owner",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const auditEvents: AccountAuditEvent[] = [];
  const audit = {
    append: vi.fn((event: AccountAuditEvent) => {
      auditEvents.push(event);
      return true;
    }),
  };
  return {
    auditEvents,
    port: createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      requireMfa: true,
      audit,
    }),
  };
}

let db: Db | null = null;

describe("sqliteAccountAdminPort invitation secrecy", () => {
  afterEach(() => {
    vi.useRealTimers();
    db?.close();
    db = null;
  });

  registerSqliteAccountAdminPortTest1();
  registerSqliteAccountAdminPortTest2();
  registerSqliteAccountAdminPortTest3();
  registerSqliteAccountAdminPortTest4();
  registerSqliteAccountAdminPortTest5();
  registerSqliteAccountAdminPortTest6();
  registerSqliteAccountAdminPortTest7();
  registerSqliteAccountAdminPortTest8();
  registerSqliteAccountAdminPortTest9();
  registerSqliteAccountAdminPortTest10();
  registerSqliteAccountAdminPortTest11();
  registerSqliteAccountAdminPortTest12();
  registerSqliteAccountAdminPortTest13();
  registerStaleInvitationReplayTest();
});

function registerSqliteAccountAdminPortTest1(): void {
  it("evaluates pre-authorised invitation expiry by instant rather than stored text order", () => {
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    createInvite(db, {
      token: "expired-offset-token",
      id: "expired-offset",
      accountId: "workspace-1",
      role: "viewer",
      preauthEmail: "expired@example.com",
      expiresAt: "2026-08-01T01:00:00+01:00",
      usedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    createInvite(db, {
      token: "live-offset-token",
      id: "live-offset",
      accountId: "workspace-1",
      role: "viewer",
      preauthEmail: "live@example.com",
      expiresAt: "2026-07-31T21:00:00-04:00",
      usedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const now = Date.parse("2026-08-01T00:30:00.000Z");

    expect(hasLivePreauthorizedInvitation(db, "expired@example.com", now)).toBe(false);
    expect(hasLivePreauthorizedInvitation(db, "live@example.com", now)).toBe(true);
  });
}

function registerSqliteAccountAdminPortTest2(): void {
  it("uses the partial live-email index for pre-authorised admission", () => {
    db = openDb(":memory:");
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
          SELECT invitation.expiresAt
            FROM invites AS invitation
            JOIN accounts AS workspace ON workspace.id = invitation.accountId
           WHERE invitation.preauthEmail = ?
             AND invitation.usedAt IS NULL`,
      )
      .all("person@example.com") as Array<{ detail: string }>;

    expect(plan.map(({ detail }) => detail).join("\n")).toContain("idx_invites_live_preauthEmail");
  });
}

function registerSqliteAccountAdminPortTest3(): void {
  it("lists ordinary invitations when a used legacy Owner invite is retained for history", async () => {
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    createInvite(db, {
      token: "used-owner-token",
      id: "used-owner",
      accountId: "workspace-1",
      role: "owner",
      preauthEmail: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    createInvite(db, {
      token: "live-editor-token",
      id: "live-editor",
      accountId: "workspace-1",
      role: "editor",
      preauthEmail: "editor@example.com",
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-01-03T00:00:00.000Z",
    });
    const port = createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    });

    await expect(port.listInvitations({ actor, workspaceId: "workspace-1" })).resolves.toEqual([
      expect.objectContaining({ id: "live-editor", role: "editor" }),
    ]);
  });
}

function registerSqliteAccountAdminPortTest4(): void {
  it("hides an expired unused invitation without mutating durable state on the read path", async () => {
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    createInvite(db, {
      token: "expired-token",
      id: "expired-invite",
      accountId: "workspace-1",
      role: "viewer",
      preauthEmail: null,
      expiresAt: "2026-01-02T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const port = createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    });

    await expect(port.listInvitations({ actor, workspaceId: "workspace-1" })).resolves.toEqual([]);
    expect(db.prepare("SELECT id FROM invites WHERE id = ?").get("expired-invite")).toEqual({
      id: "expired-invite",
    });
  });
}

function registerSqliteAccountAdminPortTest5(): void {
  it("never persists a raw invitation token in the durable command ledger", async () => {
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const port = createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    });

    const created = await port.createInvitation({
      actor,
      workspaceId: "workspace-1",
      role: "editor",
      preauthorizedEmail: "person@example.com",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      command,
    });
    const persisted = db
      .prepare(`SELECT resultJson FROM account_commands WHERE commandId = ?`)
      .get(command.commandId) as { resultJson: string };

    expect(created.token).toHaveLength(43);
    expect(persisted.resultJson).not.toContain(created.token);
    expect(JSON.parse(persisted.resultJson)).not.toHaveProperty("token");

    await expect(
      port.createInvitation({
        actor,
        workspaceId: "workspace-1",
        role: "editor",
        preauthorizedEmail: "person@example.com",
        expiresAt: created.expiresAt,
        command,
      }),
    ).resolves.toEqual(created);
  });
}

function registerSqliteAccountAdminPortTest6(): void {
  it("prunes aged used history inside both invitation creation and claim transactions", async () => {
    vi.useFakeTimers();
    const now = new Date("2027-01-01T00:00:00.000Z");
    vi.setSystemTime(now);
    const currentDb = openDb(":memory:");
    db = currentDb;
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const oldInvite = (token: string, id: string) =>
      createInvite(currentDb, {
        token,
        id,
        accountId: "workspace-1",
        role: "viewer",
        preauthEmail: null,
        expiresAt: "2025-01-02T00:00:00.000Z",
        usedAt: "2025-01-01T00:00:00.000Z",
        createdAt: "2025-01-01T00:00:00.000Z",
      });
    oldInvite("old-before-create", "old-before-create");
    const port = createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    });

    const invitation = await port.createInvitation({
      actor,
      workspaceId: "workspace-1",
      role: "viewer",
      preauthorizedEmail: null,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      command: { commandId: "retention-create-command", idempotencyKey: "retention-create-key" },
    });
    expect(getInvite(db, "old-before-create")).toBeNull();

    oldInvite("old-before-claim", "old-before-claim");
    await port.claimInvitationForPrincipal({
      token: invitation.token,
      principalId: "invitee-1",
      principalEmail: "invitee@example.com",
      emailVerified: true,
      passwordMode: true,
      command: { commandId: "retention-claim-command", idempotencyKey: "retention-claim-key" },
    });
    expect(getInvite(db, "old-before-claim")).toBeNull();
    expect(getInvite(db, invitation.token)?.usedAt).toBe(now.toISOString());
  });
}

function registerSqliteAccountAdminPortTest7(): void {
  it("drops the plaintext invitation replay after the short response-loss horizon", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAt);
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
    });
    const port = createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    });
    const input = {
      actor,
      workspaceId: "workspace-1",
      role: "editor" as const,
      preauthorizedEmail: null,
      expiresAt: new Date(startedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      command,
    };

    const created = await port.createInvitation(input);
    vi.setSystemTime(startedAt.getTime() + WRITE_ONCE_SECRET_REPLAY_WINDOW_MS - 1);
    await expect(port.createInvitation(input)).resolves.toEqual(created);

    vi.setSystemTime(startedAt.getTime() + WRITE_ONCE_SECRET_REPLAY_WINDOW_MS);
    await expect(port.createInvitation(input)).rejects.toMatchObject({ failure: { code: "CONFLICT" } });
  });
}

function registerSqliteAccountAdminPortTest8(): void {
  it("refuses invitation issuance under replay pressure without displacing a completed response", async () => {
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const port = createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
      writeOnceReplayCapacity: 1,
    });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const firstInput = {
      actor,
      workspaceId: "workspace-1",
      role: "editor" as const,
      preauthorizedEmail: null,
      expiresAt,
      command,
    };

    const first = await port.createInvitation(firstInput);
    await expect(
      port.createInvitation({
        ...firstInput,
        command: { commandId: "command-2", idempotencyKey: "idempotency-2" },
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterSeconds: WRITE_ONCE_SECRET_REPLAY_WINDOW_MS / 1_000,
      },
    });

    await expect(port.createInvitation(firstInput)).resolves.toEqual(first);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invites`).get()).toEqual({ count: 1 });
  });
}

function registerSqliteAccountAdminPortTest9(): void {
  it("keeps an unrecoverable write-once invitation visible and revocable after an adapter restart", async () => {
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const input = {
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    };
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const created = await createSqliteAccountAdminPort(input).createInvitation({
      actor,
      workspaceId: "workspace-1",
      role: "editor",
      preauthorizedEmail: null,
      expiresAt,
      command,
    });

    const restarted = createSqliteAccountAdminPort(input);
    await expect(
      restarted.createInvitation({
        actor,
        workspaceId: "workspace-1",
        role: "editor",
        preauthorizedEmail: null,
        expiresAt,
        command,
      }),
    ).rejects.toMatchObject({ failure: { code: "CONFLICT" } });

    await expect(restarted.listInvitations({ actor, workspaceId: "workspace-1" })).resolves.toEqual([
      expect.objectContaining({ id: created.id, workspaceId: "workspace-1", usedAt: null }),
    ]);
    await expect(
      restarted.revokeInvitation({
        actor,
        workspaceId: "workspace-1",
        invitationId: created.id,
        command: { commandId: "revoke-command", idempotencyKey: "revoke-idempotency" },
      }),
    ).resolves.toMatchObject({ changed: true });
    await expect(restarted.listInvitations({ actor, workspaceId: "workspace-1" })).resolves.toEqual([]);
  });
}

function registerSqliteAccountAdminPortTest10(): void {
  it("removes the write-once replay copy before a successful invitation claim releases its lock", async () => {
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const port = createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    });
    const createInput = {
      actor,
      workspaceId: "workspace-1",
      role: "editor" as const,
      preauthorizedEmail: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      command,
    };
    setMemberSignInTracking({ db, accountId: "workspace-1", actorPrincipalId: actor.principalId, enabled: true });
    const created = await port.createInvitation(createInput);
    await port.claimInvitationForPrincipal({
      token: created.token,
      principalId: "invitee-1",
      principalEmail: "invitee@example.com",
      emailVerified: false,
      passwordMode: true,
      command: { commandId: "claim-command", idempotencyKey: "claim-idempotency" },
    });
    expect(readMemberSignInTrackingSnapshot(db, "workspace-1").confirmations.get("invitee-1")).toBe(true);

    await expect(port.createInvitation(createInput)).rejects.toMatchObject({ failure: { code: "CONFLICT" } });
  });
}

function registerSqliteAccountAdminPortTest11(): void {
  it("rechecks current invitation authority before replaying a write-once token", async () => {
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    upsertMember(db, {
      accountId: "workspace-1",
      userId: actor.principalId,
      role: "owner",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const port = createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
    });
    const input = {
      actor,
      workspaceId: "workspace-1",
      role: "editor" as const,
      preauthorizedEmail: "person@example.com",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      command,
    };

    const created = await port.createInvitation(input);
    expect(created.token).toEqual(expect.any(String));
    upsertMember(db, {
      accountId: "workspace-1",
      userId: actor.principalId,
      role: "viewer",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(port.createInvitation(input)).rejects.toMatchObject({ failure: { code: "FORBIDDEN" } });
  });
}

function registerSqliteAccountAdminPortTest12(): void {
  it("validates invitation email syntax at the transport-independent port boundary", async () => {
    db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "workspace-1",
      name: "Workspace",
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const port = createSqliteAccountAdminPort({
      applicationId: "test-application",
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    });

    await expect(
      port.createInvitation({
        actor,
        workspaceId: "workspace-1",
        role: "editor",
        preauthorizedEmail: "not-an-email",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        command: { commandId: "invalid-email-command", idempotencyKey: "invalid-email-key" },
      }),
    ).rejects.toMatchObject({ failure: { code: "VALIDATION_FAILED" } });
  });
}

function registerSqliteAccountAdminPortTest13(): void {
  it("enforces MFA-backed administration, admits a stale-session invitation and emits normalized audits", async () => {
    db = openDb(":memory:");
    const { auditEvents, port } = seedMfaAuditFixture(db);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const staleActor = { ...actor, fresh: false };
    const passwordActor = { ...actor, assurance: "password" as const, mfaSatisfied: false };

    // Creating an invitation is an ordinary administrative action: role and MFA still gate it, a
    // recent sign-in does not. Only the high-impact actions keep the re-prompt.
    await port.createInvitation({
      actor: staleActor,
      workspaceId: "workspace-1",
      role: "editor",
      preauthorizedEmail: "person@example.com",
      expiresAt,
      command: { commandId: "stale-command", idempotencyKey: "stale-idempotency" },
    });
    await expect(
      port.createInvitation({
        actor: passwordActor,
        workspaceId: "workspace-1",
        role: "editor",
        preauthorizedEmail: "person@example.com",
        expiresAt,
        command: { commandId: "mfa-command", idempotencyKey: "mfa-idempotency" },
      }),
    ).rejects.toMatchObject({ failure: { code: "MFA_REQUIRED" } });
    const created = await port.createInvitation({
      actor,
      workspaceId: "workspace-1",
      role: "editor",
      preauthorizedEmail: "person@example.com",
      expiresAt,
      command: { commandId: "success-command", idempotencyKey: "success-idempotency" },
    });

    expect(auditEvents.map(({ action, outcome, commandId }) => ({ action, outcome, commandId }))).toEqual([
      { action: "invitation.created", outcome: "success", commandId: "stale-command" },
      { action: "invitation.created", outcome: "denied", commandId: "mfa-command" },
      { action: "invitation.created", outcome: "success", commandId: "success-command" },
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain(created.token);
    expect(auditEvents[2]).toMatchObject({
      applicationId: "test-application",
      workspaceId: "workspace-1",
      actorPrincipalId: actor.principalId,
      changedFields: ["role", "preauthorizedEmail", "expiresAt"],
    });
  });
}

function registerStaleInvitationReplayTest(): void {
  it("replays a created invitation for a now-stale actor while still rechecking MFA and authority", async () => {
    db = openDb(":memory:");
    const { port } = seedMfaAuditFixture(db);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const command = { commandId: "replay-command", idempotencyKey: "replay-idempotency" };
    const created = await port.createInvitation({
      actor,
      workspaceId: "workspace-1",
      role: "editor",
      preauthorizedEmail: "person@example.com",
      expiresAt,
      command,
    });

    // The replay guard re-evaluates authority before re-disclosing the write-once token. Freshness
    // is no longer part of that check, so the same command replays from an aged-out session…
    const replayed = await port.createInvitation({
      actor: { ...actor, fresh: false },
      workspaceId: "workspace-1",
      role: "editor",
      preauthorizedEmail: "person@example.com",
      expiresAt,
      command,
    });
    expect(replayed).toMatchObject({ id: created.id, token: created.token });

    // …while the guard's other checks still decide it. (A replay from a different principal never
    // reaches the guard: the command ledger rejects it as an idempotency conflict first.)
    await expect(
      port.createInvitation({
        actor: { ...actor, assurance: "password" as const, mfaSatisfied: false },
        workspaceId: "workspace-1",
        role: "editor",
        preauthorizedEmail: "person@example.com",
        expiresAt,
        command,
      }),
    ).rejects.toMatchObject({ failure: { code: "MFA_REQUIRED" } });
  });
}
