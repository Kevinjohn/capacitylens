import { afterEach, describe, expect, it } from "vitest";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type { ActorContext } from "@capacitylens/shared/account/types";
import { insertRow, openDb, type Db } from "../../db";
import { removeMember, upsertMember } from "../../controlTables";
import { readRequestById } from "../../controlTables/ownershipTransfers";
import { KeyedOperationLock } from "../KeyedOperationLock";
import { createSqliteAccountAdminPort } from "../sqliteAccountAdminPort";

const workspaceId = "stark-industries";
const owner: ActorContext = {
  principalId: "tony-stark",
  sessionId: "session-owner",
  assurance: "mfa",
  fresh: true,
  mfaSatisfied: true,
};
const target = { ...owner, principalId: "pepper-potts", sessionId: "session-target" };

let db: Db | null = null;

/** The seeded handle. A test that reaches for the database before `seedWorkspace` is a broken test,
 *  so this throws rather than letting an assertion run against nothing. */
function seeded(): Db {
  if (!db) throw new Error("test database is not seeded");
  return db;
}

function seed(auditEvents: AccountAuditEvent[] = []): ReturnType<typeof createSqliteAccountAdminPort> {
  db = openDb(":memory:");
  insertRow(db, "accounts", {
    id: workspaceId,
    name: "Stark Industries",
    color: "#6366f1",
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
  });
  upsertMember(db, {
    accountId: workspaceId,
    userId: owner.principalId,
    role: "owner",
    status: "active",
    createdAt: "2026-09-01T09:00:00.000Z",
  });
  upsertMember(db, {
    accountId: workspaceId,
    userId: target.principalId,
    role: "admin",
    status: "active",
    createdAt: "2026-09-01T09:00:00.000Z",
  });
  return createSqliteAccountAdminPort({
    applicationId: "test-application",
    db,
    lock: new KeyedOperationLock(),
    audit: { append: (event: AccountAuditEvent) => (auditEvents.push(event), true) },
  });
}

/** `seed()` plus a Better Auth `verification` table holding one outstanding reset link per
 *  participant, so completion's effect on both identities can be asserted in one place. */
function seedWithResetLinks(): ReturnType<typeof createSqliteAccountAdminPort> {
  const handle = openDb(":memory:");
  handle.exec("CREATE TABLE verification (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db = handle;
  insertRow(handle, "accounts", {
    id: workspaceId,
    name: "Stark Industries",
    color: "#6366f1",
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
  });
  for (const [principalId, role] of [
    [owner.principalId, "owner"],
    [target.principalId, "admin"],
  ] as const) {
    upsertMember(handle, {
      accountId: workspaceId,
      userId: principalId,
      role,
      status: "active",
      createdAt: "2026-09-01T09:00:00.000Z",
    });
  }
  handle
    .prepare("INSERT INTO verification (id, value) VALUES (?, ?), (?, ?)")
    .run("reset-owner", owner.principalId, "reset-target", target.principalId);
  return createSqliteAccountAdminPort({
    applicationId: "test-application",
    db: handle,
    lock: new KeyedOperationLock(),
  });
}

async function initiate(port: ReturnType<typeof createSqliteAccountAdminPort>): Promise<string> {
  const result = await port.initiateOwnershipTransfer({
    actor: owner,
    workspaceId,
    targetPrincipalId: target.principalId,
    expectedRequestId: null,
    expectedRevision: null,
    command: { commandId: "initiate-command", idempotencyKey: "initiate-key" },
  });
  if (result.kind !== "applied") throw new Error("initiation did not apply");
  return result.request.id;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("ownership transfer membership binding", () => {
  it.each([
    [
      "role changes",
      async (port: ReturnType<typeof createSqliteAccountAdminPort>) =>
        port.changeMemberRole({
          actor: owner,
          workspaceId,
          targetPrincipalId: target.principalId,
          nextRole: "editor",
          command: { commandId: "role-command", idempotencyKey: "role-key" },
        }),
    ],
    [
      "status changes",
      async (port: ReturnType<typeof createSqliteAccountAdminPort>) =>
        port.changeMemberStatus({
          actor: owner,
          workspaceId,
          targetPrincipalId: target.principalId,
          nextStatus: "disabled",
          command: { commandId: "status-command", idempotencyKey: "status-key" },
        }),
    ],
    [
      "removals",
      async (port: ReturnType<typeof createSqliteAccountAdminPort>) =>
        port.removeMember({
          actor: owner,
          workspaceId,
          targetPrincipalId: target.principalId,
          command: { commandId: "remove-command", idempotencyKey: "remove-key" },
        }),
    ],
  ])("invalidates a live request when membership %s", async (_label, mutate) => {
    const auditEvents: AccountAuditEvent[] = [];
    const port = seed(auditEvents);
    const requestId = await initiate(port);
    await mutate(port);
    expect(readRequestById(seeded(), workspaceId, requestId)).toMatchObject({
      state: "invalidated",
      revision: "1",
      terminalReason: "participant_membership_changed",
    });
    expect(auditEvents.filter(({ action }) => action === "ownership_transfer.invalidated")).toHaveLength(1);
    expect(auditEvents.find(({ action }) => action === "ownership_transfer.invalidated")?.id).toContain(
      `:${requestId}`,
    );
  });
});

describe("ownership transfer membership binding: completion effects", () => {
  it("keeps both security revisions and burns reset links during completion", async () => {
    const port = seedWithResetLinks();
    const requestId = await initiate(port);
    await port.acceptOwnershipTransfer({
      actor: target,
      workspaceId,
      requestId,
      expectedRevision: "0",
      command: { commandId: "accept-command", idempotencyKey: "accept-key" },
    });
    await port.completeOwnershipTransfer({
      actor: owner,
      workspaceId,
      requestId,
      expectedRevision: "1",
      command: { commandId: "complete-command", idempotencyKey: "complete-key" },
    });
    expect(
      seeded().prepare("SELECT userId, role FROM account_members WHERE accountId = ? ORDER BY userId").all(workspaceId),
    ).toEqual([
      { userId: "pepper-potts", role: "owner" },
      { userId: "tony-stark", role: "admin" },
    ]);
    // The exemption suppresses only transfer terminalisation: both identities still lose their
    // outstanding reset links and both security revisions still move.
    expect(
      seeded()
        .prepare(
          "SELECT principalId, revision FROM account_security_revisions WHERE principalId IN (?, ?) ORDER BY principalId",
        )
        .all(owner.principalId, target.principalId),
    ).toEqual([
      { principalId: "pepper-potts", revision: 2 },
      { principalId: "tony-stark", revision: 2 },
    ]);
    expect(seeded().prepare("SELECT COUNT(*) AS count FROM verification").get()).toEqual({ count: 0 });
  });

  it("preserves the single-owner invariant by rejecting the reverse write order", () => {
    const port = seed();
    void port;
    expect(() =>
      seeded()
        .prepare("UPDATE account_members SET role = 'owner' WHERE accountId = ? AND userId = ?")
        .run(workspaceId, target.principalId),
    ).toThrow(/UNIQUE constraint/i);
    expect(
      seeded().prepare("SELECT userId, role FROM account_members WHERE accountId = ? ORDER BY userId").all(workspaceId),
    ).toEqual([
      { userId: "pepper-potts", role: "admin" },
      { userId: "tony-stark", role: "owner" },
    ]);
  });
});

describe("ownership transfer membership binding: erasure and repair", () => {
  it("terminalises before erasure and leaves no ceremony audit event", async () => {
    const auditEvents: AccountAuditEvent[] = [];
    const port = seed(auditEvents);
    const requestId = await initiate(port);
    port.eraseWorkspaceAdministrationInTx(workspaceId);
    expect(readRequestById(seeded(), workspaceId, requestId)).toBeNull();
    expect(
      auditEvents.filter(({ action }) => action.startsWith("ownership_transfer.")).map(({ action }) => action),
    ).toEqual(["ownership_transfer.initiated"]);
  });

  it("terminalises the live request before repairing an ownerless workspace", async () => {
    const auditEvents: AccountAuditEvent[] = [];
    const port = seed(auditEvents);
    const requestId = await initiate(port);
    seeded()
      .prepare("UPDATE account_members SET role = 'admin' WHERE accountId = ? AND userId = ?")
      .run(workspaceId, owner.principalId);
    expect(port.repairOwnerlessWorkspaceInTx(workspaceId, target.principalId)).toBe(true);
    expect(readRequestById(seeded(), workspaceId, requestId)).toMatchObject({
      state: "invalidated",
      terminalReason: "owner_repaired",
    });
    expect(
      seeded()
        .prepare("SELECT role FROM account_members WHERE accountId = ? AND userId = ?")
        .get(workspaceId, target.principalId),
    ).toEqual({ role: "owner" });
    expect(auditEvents.filter(({ action }) => action === "ownership_transfer.invalidated")).toHaveLength(0);
  });

  it("exposes the terminalised ids from a direct membership write", async () => {
    const port = seed();
    const requestId = await initiate(port);
    const invalidated = removeMember(seeded(), workspaceId, target.principalId);
    expect(invalidated).toEqual([requestId]);
    expect(readRequestById(seeded(), workspaceId, requestId)).toMatchObject({ state: "invalidated" });
  });
});
