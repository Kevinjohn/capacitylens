import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@capacitylens/shared/account/types";
import { getInvite, upsertMember } from "../controlTables";
import { openDb, insertRow, type Db } from "../db";
import { KeyedOperationLock } from "./KeyedOperationLock";
import { createSqliteAccountAdminPort } from "./sqliteAccountAdminPort";

const actor: ActorContext = {
  principalId: "owner-1",
  sessionId: "session-1",
  assurance: "mfa",
  fresh: true,
  mfaSatisfied: true,
};

function expectFailureCode(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error: unknown) {
    expect(error).toMatchObject({ failure: { code } });
    return;
  }
  throw new Error(`Expected operation to fail with ${code}`);
}

function seedIdentityRepairFixture(db: Db): void {
  for (const id of ["workspace-a", "workspace-b"]) {
    insertRow(db, "accounts", {
      id,
      name: id,
      color: "#6366f1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  for (const accountId of ["workspace-a", "workspace-b"]) {
    upsertMember(db, {
      accountId,
      userId: actor.principalId,
      role: "owner",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }
  upsertMember(db, {
    accountId: "workspace-b",
    userId: "target-1",
    role: "viewer",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("sqliteAccountAdminPort authority integrity", () => {
  registerSqliteAccountAdminPortTest14();
  registerSqliteAccountAdminPortTest15();
  registerSqliteAccountAdminPortTest16();
  registerSqliteAccountAdminPortTest17();
  registerSqliteAccountAdminPortTest18();
  registerSqliteAccountAdminPortTest19();
  registerSqliteAccountAdminPortTest20();
  registerSqliteAccountAdminPortTest21();
  registerSqliteAccountAdminPortTest22();
  registerSqliteAccountAdminPortTest23();
  registerSqliteAccountAdminPortTest24();
  registerSqliteAccountAdminPortTest30();
});

function registerSqliteAccountAdminPortTest14(): void {
  it("evaluates a member batch with one actor-role and live-workspace snapshot", async () => {
    const db = openDb(":memory:");
    try {
      for (const workspaceId of ["workspace-1", "workspace-2"]) {
        insertRow(db, "accounts", {
          id: workspaceId,
          name: workspaceId,
          color: "#6366f1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
        upsertMember(db, {
          accountId: workspaceId,
          userId: actor.principalId,
          role: "owner",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      upsertMember(db, {
        accountId: "workspace-1",
        userId: "target-1",
        role: "editor",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      upsertMember(db, {
        accountId: "workspace-2",
        userId: "target-2",
        role: "viewer",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
      });
      const prepare = vi.spyOn(db, "prepare");

      const results = await port.evaluateIdentityAdminAuthoritiesForTargets({
        actor,
        targetPrincipalIds: ["target-1", "target-2"],
        actions: ["issue-password-reset", "revoke-sessions"],
      });

      expect(results.get("target-1")?.get("issue-password-reset")).toMatchObject({ allowed: true });
      expect(results.get("target-2")?.get("revoke-sessions")).toMatchObject({ allowed: true });
      const statements = prepare.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
      expect(statements.filter((sql) => sql.includes("FROM account_members WHERE userId = ?"))).toHaveLength(3);
      expect(statements.filter((sql) => sql === "SELECT id FROM accounts")).toHaveLength(1);
      prepare.mockRestore();
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest15(): void {
  it("does not expose or administer membership rows for an erased workspace", async () => {
    const db = openDb(":memory:");
    try {
      upsertMember(db, {
        accountId: "erased-workspace",
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

      await expect(
        port.getMembership({
          principalId: actor.principalId,
          workspaceId: "erased-workspace",
        }),
      ).resolves.toBeNull();
      await expect(
        port.listMemberships({
          actor,
          workspaceId: "erased-workspace",
        }),
      ).rejects.toMatchObject({ failure: { code: "NOT_FOUND" } });
      await expect(
        port.changeMemberRole({
          actor,
          workspaceId: "erased-workspace",
          targetPrincipalId: actor.principalId,
          nextRole: "admin",
          command: { commandId: "dangling-role-command", idempotencyKey: "dangling-role-key" },
        }),
      ).rejects.toMatchObject({ failure: { code: "NOT_FOUND" } });
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest16(): void {
  it("enforces administrative session assurance at privileged read port boundaries", async () => {
    const db = openDb(":memory:");
    try {
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
        requireMfa: true,
      });

      await expect(
        port.listMemberships({
          actor: { ...actor, fresh: false },
          workspaceId: "workspace-1",
        }),
      ).rejects.toMatchObject({ failure: { code: "SESSION_NOT_FRESH" } });
      await expect(
        port.listInvitations({
          actor: { ...actor, assurance: "password", mfaSatisfied: false },
          workspaceId: "workspace-1",
        }),
      ).rejects.toMatchObject({ failure: { code: "MFA_REQUIRED" } });
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest17(): void {
  it("requires administrative assurance for membership-authorized workspace provisioning", () => {
    const db = openDb(":memory:");
    try {
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
        requireMfa: true,
      });
      const evaluate = (candidate: ActorContext) =>
        port.evaluateWorkspaceProvisioningAuthorityInTx({
          actor: candidate,
          multiWorkspace: true,
          bootstrapAuthorized: false,
        });

      expectFailureCode(() => evaluate({ ...actor, fresh: false }), "SESSION_NOT_FRESH");
      expectFailureCode(() => evaluate({ ...actor, assurance: "password", mfaSatisfied: false }), "MFA_REQUIRED");
      expect(evaluate(actor)).toEqual({ allowed: true });
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest18(): void {
  it("does not let an inactive control row confer workspace administration authority", async () => {
    const db = openDb(":memory:");
    try {
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
        status: "invited" as never,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
      });

      expect(port.roleForPrincipalInWorkspace(actor.principalId, "workspace-1")).toBeNull();
      await expect(
        port.createInvitation({
          actor,
          workspaceId: "workspace-1",
          role: "editor",
          preauthorizedEmail: "person@example.com",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          command: { commandId: "inactive-actor-command", idempotencyKey: "inactive-actor-key" },
        }),
      ).rejects.toMatchObject({ failure: { code: "NOT_MEMBER" } });
    } finally {
      db.close();
    }
  });
}

// Was "reactivates an inactive invitee with the invitation role rather than its stale role". The
// #175 review closed that door entirely: redeeming an invite is no longer a way back INTO a
// non-active membership at any role, because it would let the suspended party reverse their own
// suspension with no `member.status_changed` record. The escalation half of the old assertion is
// kept and strengthened — the stale `owner` role must not survive either.
function registerSqliteAccountAdminPortTest19(): void {
  it("refuses an invite claim against a non-active membership, granting neither role", async () => {
    const db = openDb(":memory:");
    try {
      insertRow(db, "accounts", {
        id: "workspace-1",
        name: "Workspace",
        color: "#6366f1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      upsertMember(db, {
        accountId: "workspace-1",
        userId: "invitee-1",
        role: "owner",
        status: "invited" as never,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
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
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        command: { commandId: "inactive-create-command", idempotencyKey: "inactive-create-key" },
      });

      await expect(
        port.claimInvitationForPrincipal({
          token: invitation.token,
          principalId: "invitee-1",
          principalEmail: "invitee@example.com",
          emailVerified: false,
          passwordMode: true,
          command: { commandId: "inactive-claim-command", idempotencyKey: "inactive-claim-key" },
        }),
      ).rejects.toMatchObject({ failure: { code: "FORBIDDEN" } });
      // No entry at all: the stale row still confers nothing, so the claim bought neither the
      // invitation's viewer role nor the row's stale owner role.
      expect(port.roleForPrincipalInWorkspace("invitee-1", "workspace-1")).toBeNull();
      expect(getInvite(db, invitation.token)?.usedAt ?? null).toBeNull();
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest20(): void {
  it("replays a committed invitation acceptance after the invite row is removed", async () => {
    const db = openDb(":memory:");
    try {
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
        trustedLocal: true,
      });
      const invitation = await port.createInvitation({
        actor,
        workspaceId: "workspace-1",
        role: "editor",
        preauthorizedEmail: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        command: { commandId: "accept-create-command", idempotencyKey: "accept-create-key" },
      });
      const invitee = { ...actor, principalId: "invitee-1", sessionId: "invitee-session" };
      const acceptCommand = { commandId: "accept-command", idempotencyKey: "accept-key" };
      const accepted = await port.acceptInvitation({
        actor: invitee,
        token: invitation.token,
        principalEmail: "invitee@example.com",
        emailVerified: true,
        command: acceptCommand,
      });
      db.prepare("DELETE FROM invites WHERE id = ?").run(invitation.id);

      await expect(
        port.acceptInvitation({
          actor: invitee,
          token: invitation.token,
          principalEmail: "invitee@example.com",
          emailVerified: true,
          command: acceptCommand,
        }),
      ).resolves.toEqual(accepted);
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest21(): void {
  it("replays a committed principal invitation claim after the invite row is removed", async () => {
    const db = openDb(":memory:");
    try {
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
        trustedLocal: true,
      });
      const invitation = await port.createInvitation({
        actor,
        workspaceId: "workspace-1",
        role: "viewer",
        preauthorizedEmail: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        command: { commandId: "claim-create-command", idempotencyKey: "claim-create-key" },
      });
      const claimCommand = { commandId: "claim-command", idempotencyKey: "claim-key" };
      const claimed = await port.claimInvitationForPrincipal({
        token: invitation.token,
        principalId: "principal-1",
        principalEmail: "principal@example.com",
        emailVerified: true,
        passwordMode: true,
        command: claimCommand,
      });
      db.prepare("DELETE FROM invites WHERE id = ?").run(invitation.id);

      await expect(
        port.claimInvitationForPrincipal({
          token: invitation.token,
          principalId: "principal-1",
          principalEmail: "principal@example.com",
          emailVerified: true,
          passwordMode: true,
          command: claimCommand,
        }),
      ).resolves.toEqual(claimed);
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest22(): void {
  it("ignores dangling membership rows when evaluating identity-global authority", async () => {
    const db = openDb(":memory:");
    try {
      upsertMember(db, {
        accountId: "erased-workspace",
        userId: actor.principalId,
        role: "owner",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      upsertMember(db, {
        accountId: "erased-workspace",
        userId: "target-1",
        role: "viewer",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
      });

      await expect(
        port.evaluateIdentityAdminAuthority({
          actor,
          targetPrincipalId: "target-1",
          action: "issue-password-reset",
        }),
      ).resolves.toEqual({ allowed: false, reason: "target-not-member" });
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest23(): void {
  it("binds identity repair to the requested workspace and exact authority revision", async () => {
    const db = openDb(":memory:");
    try {
      seedIdentityRepairFixture(db);
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
      });
      const crossWorkspace = await port.evaluateIdentityAdminAuthority({
        actor,
        targetPrincipalId: "target-1",
        action: "correct-email",
      });
      expect(crossWorkspace.allowed).toBe(true);
      expect(() =>
        port.assertIdentityRepairAuthorityInTx({
          actor,
          workspaceId: "workspace-a",
          targetPrincipalId: "target-1",
          action: "correct-email",
          expectedRevision: crossWorkspace.allowed ? crossWorkspace.revision : "unreachable",
        }),
      ).toThrow(/not a member/i);

      upsertMember(db, {
        accountId: "workspace-a",
        userId: "target-1",
        role: "viewer",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const initial = await port.evaluateIdentityAdminAuthority({
        actor,
        targetPrincipalId: "target-1",
        action: "correct-email",
      });
      expect(initial.allowed).toBe(true);
      upsertMember(db, {
        accountId: "workspace-a",
        userId: "target-1",
        role: "editor",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(() =>
        port.assertIdentityRepairAuthorityInTx({
          actor,
          workspaceId: "workspace-a",
          targetPrincipalId: "target-1",
          action: "correct-email",
          expectedRevision: initial.allowed ? initial.revision : "unreachable",
        }),
      ).toThrow(/authority changed/i);
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest24(): void {
  it.each([
    { caseName: "existing workspace", survivingWorkspaceExists: true, expectedUnaffiliated: [] },
    { caseName: "orphan membership", survivingWorkspaceExists: false, expectedUnaffiliated: ["principal-1"] },
  ])("checks surviving workspace existence for $caseName", ({ survivingWorkspaceExists, expectedUnaffiliated }) => {
    const db = openDb(":memory:");
    try {
      for (const id of ["erased-workspace", ...(survivingWorkspaceExists ? ["surviving-workspace"] : [])]) {
        insertRow(db, "accounts", {
          id,
          name: id,
          color: "#6366f1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }
      upsertMember(db, {
        accountId: "erased-workspace",
        userId: "principal-1",
        role: "editor",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      upsertMember(db, {
        accountId: "surviving-workspace",
        userId: "principal-1",
        role: "viewer",
        status: "suspended" as never,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
        trustedLocal: true,
      });

      expect(port.eraseWorkspaceAdministrationInTx("erased-workspace")).toEqual(expectedUnaffiliated);
      expect(db.prepare("SELECT status FROM account_members WHERE userId = ?").get("principal-1")).toEqual({
        status: "suspended",
      });
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest30(): void {
  it("does not let injected input override identity-repair authority dependencies", async () => {
    const db = openDb(":memory:");
    const injectedDb = openDb(":memory:");
    try {
      seedIdentityRepairFixture(db);
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
        requireMfa: true,
      });
      const authority = await port.evaluateIdentityAdminAuthority({
        actor,
        targetPrincipalId: "target-1",
        action: "correct-email",
      });
      if (!authority.allowed) throw new Error("Expected identity repair authority");
      const injectedInput: Parameters<typeof port.assertIdentityRepairAuthorityInTx>[0] & {
        db: Db;
        trustedLocal: boolean;
        requireMfa: boolean;
      } = {
        actor: { ...actor, fresh: false, mfaSatisfied: false },
        workspaceId: "workspace-b",
        targetPrincipalId: "target-1",
        action: "correct-email",
        expectedRevision: authority.revision,
        db: injectedDb,
        trustedLocal: true,
        requireMfa: false,
      };

      expectFailureCode(() => port.assertIdentityRepairAuthorityInTx(injectedInput), "SESSION_NOT_FRESH");
      port.assertIdentityRepairAuthorityInTx({ ...injectedInput, actor });
    } finally {
      injectedDb.close();
      db.close();
    }
  });
}
