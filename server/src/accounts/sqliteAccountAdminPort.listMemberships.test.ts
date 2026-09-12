import { describe, expect, it, vi } from "vitest";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type { ActorContext } from "@capacitylens/shared/account/types";
import { upsertMember } from "../controlTables";
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

describe("sqliteAccountAdminPort listMemberships bulk revisions", () => {
  registerSqliteAccountAdminPortTest25();
  registerSqliteAccountAdminPortTest26();
  registerSqliteAccountAdminPortTest27();
  registerSqliteAccountAdminPortTest28();
  registerSqliteAccountAdminPortTest29();
  registerSqliteAccountAdminPortTest31();
});

const workspaceId = "workspace-1";

function seedWorkspace(db: Db): void {
  insertRow(db, "accounts", {
    id: workspaceId,
    name: "Workspace",
    color: "#6366f1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

// Bypasses upsertMember's automatic bumpSecurityRevision, so the membership row exists with NO
// account_security_revisions row — the "never signed in since" case the 0-default must cover.
function insertMemberRaw(
  db: Db,
  member: { accountId: string; userId: string; role: string; status: string; createdAt: string },
): void {
  db.prepare(`INSERT INTO account_members (accountId, userId, role, status, createdAt) VALUES (?, ?, ?, ?, ?)`).run(
    member.accountId,
    member.userId,
    member.role,
    member.status,
    member.createdAt,
  );
}

function setSecurityRevision(db: Db, principalId: string, revision: number): void {
  db.prepare(`INSERT INTO account_security_revisions (principalId, revision, updatedAt) VALUES (?, ?, ?)`).run(
    principalId,
    revision,
    "2026-01-01T00:00:00.000Z",
  );
}

function registerSqliteAccountAdminPortTest25(): void {
  it("defaults a member's revision to 0 when it has no account_security_revisions row", async () => {
    const db = openDb(":memory:");
    try {
      seedWorkspace(db);
      insertMemberRaw(db, {
        accountId: workspaceId,
        userId: "never-signed-in",
        role: "viewer",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
        trustedLocal: true,
      });

      const result = await port.listMemberships({ actor, workspaceId });

      expect(result).toEqual([expect.objectContaining({ principalId: "never-signed-in", membershipRevision: "0" })]);
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest26(): void {
  it("returns each member's own revision when revisions differ across the workspace", async () => {
    const db = openDb(":memory:");
    try {
      seedWorkspace(db);
      // Auto-bumped to revision 1 by upsertMember's post-write security handling.
      upsertMember(db, {
        accountId: workspaceId,
        userId: "bumped-once",
        role: "editor",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      insertMemberRaw(db, {
        accountId: workspaceId,
        userId: "never-signed-in",
        role: "viewer",
        status: "active",
        createdAt: "2026-01-02T00:00:00.000Z",
      });
      insertMemberRaw(db, {
        accountId: workspaceId,
        userId: "high-revision",
        role: "admin",
        status: "active",
        createdAt: "2026-01-03T00:00:00.000Z",
      });
      setSecurityRevision(db, "high-revision", 7);
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
        trustedLocal: true,
      });

      const result = await port.listMemberships({ actor, workspaceId });

      expect(result).toEqual([
        expect.objectContaining({ principalId: "bumped-once", membershipRevision: "1" }),
        expect.objectContaining({ principalId: "never-signed-in", membershipRevision: "0" }),
        expect.objectContaining({ principalId: "high-revision", membershipRevision: "7" }),
      ]);
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest27(): void {
  it("preserves listMembersForAccount's ordering and the includeInactive status filter", async () => {
    const db = openDb(":memory:");
    try {
      seedWorkspace(db);
      insertMemberRaw(db, {
        accountId: workspaceId,
        userId: "zed",
        role: "viewer",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      insertMemberRaw(db, {
        accountId: workspaceId,
        userId: "alpha",
        role: "viewer",
        status: "disabled",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      insertMemberRaw(db, {
        accountId: workspaceId,
        userId: "middle",
        role: "viewer",
        status: "active",
        createdAt: "2026-01-02T00:00:00.000Z",
      });
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
        trustedLocal: true,
      });

      // Default active-only: "alpha" (disabled) is dropped but the remaining order is preserved.
      const activeOnly = await port.listMemberships({ actor, workspaceId });
      expect(activeOnly.map((m) => m.principalId)).toEqual(["zed", "middle"]);

      // includeInactive surfaces "alpha" too — listMembersForAccount orders by createdAt, userId,
      // so the tie between "zed" and "alpha" (same createdAt) breaks alphabetically.
      const all = await port.listMemberships({ actor, workspaceId, includeInactive: true });
      expect(all.map((m) => m.principalId)).toEqual(["alpha", "zed", "middle"]);
      expect(all.find((m) => m.principalId === "alpha")?.status).toBe("disabled");
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest28(): void {
  it("returns an empty array and issues no revision query for a workspace with no members", async () => {
    const db = openDb(":memory:");
    try {
      seedWorkspace(db);
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
        trustedLocal: true,
      });
      const prepare = vi.spyOn(db, "prepare");

      const result = await port.listMemberships({ actor, workspaceId });

      expect(result).toEqual([]);
      const statements = prepare.mock.calls.map(([sql]) => String(sql));
      expect(statements.some((sql) => sql.includes("account_security_revisions"))).toBe(false);
      prepare.mockRestore();
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest29(): void {
  it("chunks the revision IN-query at 500 principals and keeps every member's own revision across the boundary", async () => {
    const db = openDb(":memory:");
    try {
      seedWorkspace(db);
      const total = 501;
      for (let i = 0; i < total; i++) {
        const userId = `member-${String(i).padStart(4, "0")}`;
        insertMemberRaw(db, {
          accountId: workspaceId,
          userId,
          role: "viewer",
          status: "active",
          createdAt: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
        });
        setSecurityRevision(db, userId, i);
      }
      const port = createSqliteAccountAdminPort({
        applicationId: "test-application",
        db,
        lock: new KeyedOperationLock(),
        trustedLocal: true,
      });
      const prepare = vi.spyOn(db, "prepare");

      const result = await port.listMemberships({ actor, workspaceId });

      expect(result).toHaveLength(total);
      const byId = new Map(result.map((m) => [m.principalId, m]));
      expect(byId.get("member-0000")?.membershipRevision).toBe("0");
      expect(byId.get("member-0499")?.membershipRevision).toBe("499");
      expect(byId.get("member-0500")?.membershipRevision).toBe("500");
      const revisionQueries = prepare.mock.calls.filter(([sql]) => String(sql).includes("account_security_revisions"));
      expect(revisionQueries).toHaveLength(2);
      prepare.mockRestore();
    } finally {
      db.close();
    }
  });
}

function registerSqliteAccountAdminPortTest31(): void {
  it("keeps MFA required when a member directory explicitly opts out of freshness", async () => {
    const db = openDb(":memory:");
    try {
      const { port } = seedMfaAuditFixture(db);
      const staleWithoutMfa = { ...actor, fresh: false, mfaSatisfied: false };

      await expect(
        port.listMemberships({ actor: staleWithoutMfa, workspaceId: "workspace-1", requireFresh: false }),
      ).rejects.toMatchObject({ failure: { code: "MFA_REQUIRED" } });
    } finally {
      db.close();
    }
  });
}
