import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type { ActorContext, CommandIdentity } from "@capacitylens/shared/account/types";
import { insertRow, openDb, type Db } from "../../db";
import { upsertMember } from "../../controlTables";
import { readRequestById } from "../../controlTables/ownershipTransfers";
import { KeyedOperationLock } from "../KeyedOperationLock";
import { createSqliteAccountAdminPort } from "../sqliteAccountAdminPort";

const workspaceId = "wayne-enterprises";
const owner: ActorContext = {
  principalId: "bruce-wayne",
  sessionId: "session-owner",
  assurance: "mfa",
  fresh: true,
  mfaSatisfied: true,
};
const target: ActorContext = { ...owner, principalId: "selina-kyle", sessionId: "session-target" };
const observer: ActorContext = { ...owner, principalId: "barbara-gordon", sessionId: "session-observer" };

let db: Db | null = null;

/** The seeded handle. A test that reaches for the database before `seedWorkspace` is a broken test,
 *  so this throws rather than letting an assertion run against nothing. */
function seeded(): Db {
  if (!db) throw new Error("test database is not seeded");
  return db;
}

function command(name: string): CommandIdentity {
  return { commandId: `${name}-command`, idempotencyKey: `${name}-key` };
}

function seedWorkspace(options: { targetRole?: "admin" | "editor"; observer?: boolean } = {}): void {
  db = openDb(":memory:");
  insertRow(db, "accounts", {
    id: workspaceId,
    name: "Wayne Enterprises",
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
    role: options.targetRole ?? "admin",
    status: "active",
    createdAt: "2026-09-01T09:00:00.000Z",
  });
  if (options.observer) {
    upsertMember(db, {
      accountId: workspaceId,
      userId: observer.principalId,
      role: "admin",
      status: "active",
      createdAt: "2026-09-01T09:00:00.000Z",
    });
  }
}

function createPort(auditEvents: AccountAuditEvent[] = []) {
  if (!db) throw new Error("test database is not seeded");
  return createSqliteAccountAdminPort({
    applicationId: "test-application",
    db,
    lock: new KeyedOperationLock(),
    audit: { append: (event: AccountAuditEvent) => (auditEvents.push(event), true) },
  });
}

function membershipRoles(): Array<{ userId: string; role: string; status: string }> {
  return seeded()
    .prepare("SELECT userId, role, status FROM account_members WHERE accountId = ? ORDER BY userId")
    .all(workspaceId) as Array<{ userId: string; role: string; status: string }>;
}

function commandLedger(commandId: string): { status: string; failureCode: string | null } {
  return seeded().prepare("SELECT status, failureCode FROM account_commands WHERE commandId = ?").get(commandId) as {
    status: string;
    failureCode: string | null;
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  db?.close();
  db = null;
});

type CeremonyPort = ReturnType<typeof createPort>;

/** One row command, named by its action. The five share an input shape, so a table-driven caller
 *  keeps a multi-step ceremony readable as the sequence of states it walks. */
function act(
  port: CeremonyPort,
  action: "accept" | "withdraw" | "decline" | "cancel" | "complete",
  input: { actor: ActorContext; requestId: string; expectedRevision: string; name: string },
) {
  const call = {
    accept: port.acceptOwnershipTransfer,
    withdraw: port.withdrawOwnershipTransfer,
    decline: port.declineOwnershipTransfer,
    cancel: port.cancelOwnershipTransfer,
    complete: port.completeOwnershipTransfer,
  }[action];
  return call({
    actor: input.actor,
    workspaceId,
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    command: command(input.name),
  });
}

describe("ownership transfer ceremony port", () => {
  it("runs accept, withdraw, accept, and complete as distinct revisioned transitions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T09:00:00.000Z"));
    seedWorkspace();
    const auditEvents: AccountAuditEvent[] = [];
    const port = createPort(auditEvents);

    const initiated = await port.initiateOwnershipTransfer({
      actor: owner,
      workspaceId,
      targetPrincipalId: target.principalId,
      expectedRequestId: null,
      expectedRevision: null,
      command: command("initiate"),
    });
    expect(initiated).toMatchObject({ kind: "applied", request: { state: "awaiting_target", revision: "0" } });
    if (initiated.kind !== "applied") throw new Error("initiation did not apply");
    const requestId = initiated.request.id;

    // Accept → withdraw → accept returns to a state the request already held, so the revision, not
    // the state, is what distinguishes the two acceptance cycles.
    expect(
      await act(port, "accept", { actor: target, requestId, expectedRevision: "0", name: "accept-1" }),
    ).toMatchObject({ kind: "applied", request: { state: "awaiting_owner", revision: "1" } });
    expect(
      await act(port, "withdraw", { actor: target, requestId, expectedRevision: "1", name: "withdraw" }),
    ).toMatchObject({ kind: "applied", request: { state: "awaiting_target", revision: "2", targetAcceptedAt: null } });
    expect(
      await act(port, "accept", { actor: target, requestId, expectedRevision: "2", name: "accept-2" }),
    ).toMatchObject({ kind: "applied", request: { state: "awaiting_owner", revision: "3" } });
    expect(
      await act(port, "complete", { actor: owner, requestId, expectedRevision: "3", name: "complete" }),
    ).toMatchObject({ kind: "applied", request: { state: "completed", revision: "4" } });

    expect(membershipRoles()).toEqual([
      { userId: "bruce-wayne", role: "admin", status: "active" },
      { userId: "selina-kyle", role: "owner", status: "active" },
    ]);
    expect(auditEvents.map(({ action, outcome }) => ({ action, outcome }))).toEqual([
      { action: "ownership_transfer.initiated", outcome: "success" },
      { action: "ownership_transfer.accepted", outcome: "success" },
      { action: "ownership_transfer.withdrawn", outcome: "success" },
      { action: "ownership_transfer.accepted", outcome: "success" },
      { action: "ownership_transfer.completed", outcome: "success" },
    ]);
    expect(auditEvents.every(({ id }) => id.endsWith(`:${requestId}`))).toBe(true);
  });
});

describe("ownership transfer ceremony port: expiry", () => {
  it("authorises a participant before materialising expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T09:00:00.000Z"));
    seedWorkspace({ observer: true });
    const auditEvents: AccountAuditEvent[] = [];
    const port = createPort(auditEvents);
    const initiated = await port.initiateOwnershipTransfer({
      actor: owner,
      workspaceId,
      targetPrincipalId: target.principalId,
      expectedRequestId: null,
      expectedRevision: null,
      command: command("initiate"),
    });
    if (initiated.kind !== "applied") throw new Error("initiation did not apply");
    // Backdate the whole row: the table CHECKs `createdAt < expiresAt`, so moving only the deadline
    // into the past is not a state the database can hold.
    seeded()
      .prepare("UPDATE account_ownership_transfers SET createdAt = ?, expiresAt = ? WHERE id = ?")
      .run("2026-08-25T09:00:00.000Z", "2026-09-01T09:00:00.000Z", initiated.request.id);
    await expect(port.readOwnershipTransfer({ actor: observer, workspaceId })).resolves.toEqual({
      live: null,
      latestOutcome: null,
    });
    // The participant is told the deadline has passed, without the read writing it: the projection
    // says what is true, the next command is what makes it durable.
    await expect(port.readOwnershipTransfer({ actor: target, workspaceId })).resolves.toMatchObject({
      live: null,
      latestOutcome: { id: initiated.request.id, state: "expired", terminalReason: "deadline_passed" },
    });
    expect(readRequestById(seeded(), workspaceId, initiated.request.id)).toMatchObject({
      state: "awaiting_target",
      revision: "0",
    });

    await expect(
      port.declineOwnershipTransfer({
        actor: observer,
        workspaceId,
        requestId: initiated.request.id,
        expectedRevision: "0",
        command: command("observer-decline"),
      }),
    ).rejects.toMatchObject({ failure: { code: "FORBIDDEN" } });
    expect(readRequestById(seeded(), workspaceId, initiated.request.id)).toMatchObject({
      state: "awaiting_target",
      revision: "0",
    });
    expect(commandLedger(command("observer-decline").commandId)).toEqual({
      status: "compensated",
      failureCode: "FORBIDDEN",
    });
    expect(auditEvents.at(-1)).toMatchObject({ action: "ownership_transfer.declined", outcome: "denied" });

    const expired = await port.declineOwnershipTransfer({
      actor: target,
      workspaceId,
      requestId: initiated.request.id,
      expectedRevision: "0",
      command: command("target-decline"),
    });
    expect(expired).toEqual({ kind: "terminal", state: "expired", reason: "deadline_passed" });
    expect(auditEvents.at(-1)).toMatchObject({ action: "ownership_transfer.expired", outcome: "success" });
  });
});

describe("ownership transfer ceremony port: rejections and replay", () => {
  it("leaves the workflow and memberships untouched when reading the row fails", async () => {
    seedWorkspace();
    const auditEvents: AccountAuditEvent[] = [];
    const port = createPort(auditEvents);
    const initiated = await port.initiateOwnershipTransfer({
      actor: owner,
      workspaceId,
      targetPrincipalId: target.principalId,
      expectedRequestId: null,
      expectedRevision: null,
      command: command("initiate"),
    });
    if (initiated.kind !== "applied") throw new Error("initiation did not apply");
    const before = membershipRoles();
    const prepare = seeded().prepare.bind(db);
    vi.spyOn(seeded(), "prepare").mockImplementation((sql: string) => {
      if (sql.includes("FROM account_ownership_transfers")) throw new Error("injected retryable read failure");
      return prepare(sql);
    });

    await expect(
      port.acceptOwnershipTransfer({
        actor: target,
        workspaceId,
        requestId: initiated.request.id,
        expectedRevision: "0",
        command: command("failed-read"),
      }),
    ).rejects.toThrow("injected retryable read failure");
    vi.restoreAllMocks();
    expect(readRequestById(seeded(), workspaceId, initiated.request.id)).toMatchObject({
      state: "awaiting_target",
      revision: "0",
    });
    expect(membershipRoles()).toEqual(before);
    expect(commandLedger(command("failed-read").commandId)).toEqual({ status: "compensated", failureCode: "CONFLICT" });
    expect(auditEvents.at(-1)).toMatchObject({ action: "ownership_transfer.accepted", outcome: "failed" });
  });
});

describe("ownership transfer ceremony port: replay", () => {
  it("replays the stored initiation receipt after the former owner is demoted", async () => {
    seedWorkspace();
    const auditEvents: AccountAuditEvent[] = [];
    const port = createPort(auditEvents);
    const first = await port.initiateOwnershipTransfer({
      actor: owner,
      workspaceId,
      targetPrincipalId: target.principalId,
      expectedRequestId: null,
      expectedRevision: null,
      command: command("initiate"),
    });
    upsertMember(seeded(), {
      accountId: workspaceId,
      userId: owner.principalId,
      role: "admin",
      status: "active",
      createdAt: "2026-09-01T09:00:00.000Z",
    });
    await expect(
      port.initiateOwnershipTransfer({
        actor: owner,
        workspaceId,
        targetPrincipalId: target.principalId,
        expectedRequestId: null,
        expectedRevision: null,
        command: command("initiate"),
      }),
    ).resolves.toEqual(first);
    expect(auditEvents.filter(({ action }) => action === "ownership_transfer.initiated")).toHaveLength(1);
  });
});

describe("ownership transfer ceremony port: staying readable and unblocked", () => {
  it("shows the ceremony to a participant whose session is no longer fresh", async () => {
    seedWorkspace();
    const port = createPort();
    const initiated = await port.initiateOwnershipTransfer({
      actor: owner,
      workspaceId,
      targetPrincipalId: target.principalId,
      expectedRequestId: null,
      expectedRevision: null,
      command: command("initiate"),
    });
    if (initiated.kind !== "applied") throw new Error("initiation did not apply");
    // Freshness is a threshold for ACTING. An Owner who signed in an hour ago must still be able to
    // see the nomination they are being asked to approve, or the ceremony is unreachable.
    await expect(port.readOwnershipTransfer({ actor: { ...owner, fresh: false }, workspaceId })).resolves.toMatchObject(
      { live: { id: initiated.request.id, state: "awaiting_target" } },
    );
  });

  it("commits a forgotten request's expiry rather than letting it block the next nomination", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T09:00:00.000Z"));
    seedWorkspace({ observer: true });
    const auditEvents: AccountAuditEvent[] = [];
    const port = createPort(auditEvents);
    const stale = await port.initiateOwnershipTransfer({
      actor: owner,
      workspaceId,
      targetPrincipalId: target.principalId,
      expectedRequestId: null,
      expectedRevision: null,
      command: command("initiate"),
    });
    if (stale.kind !== "applied") throw new Error("initiation did not apply");
    seeded()
      .prepare("UPDATE account_ownership_transfers SET createdAt = ?, expiresAt = ? WHERE id = ?")
      .run("2026-08-25T09:00:00.000Z", "2026-09-01T09:00:00.000Z", stale.request.id);

    // The Owner nominates somebody else WITHOUT naming the dead request: there is nothing to replace.
    const next = await port.initiateOwnershipTransfer({
      actor: owner,
      workspaceId,
      targetPrincipalId: observer.principalId,
      expectedRequestId: null,
      expectedRevision: null,
      command: command("second"),
    });
    expect(next.kind).toBe("applied");
    expect(readRequestById(seeded(), workspaceId, stale.request.id)).toMatchObject({
      state: "expired",
      terminalReason: "deadline_passed",
    });
    // A ceremony that ended leaves a record of ending, wherever the expiry was committed.
    const expiries = auditEvents.filter(({ action }) => action === "ownership_transfer.expired");
    expect(expiries).toHaveLength(1);
    expect(expiries[0]?.outcome).toBe("success");
    expect(expiries[0]?.id).toContain(`:${stale.request.id}`);
  });
});

describe("ownership transfer ceremony port: replacement beliefs", () => {
  // "Replace exactly this one, at exactly this revision" must not become "replace whatever is there"
  // merely because a deadline passed while the card was open.
  it("still refuses a replacement predicate that names the wrong request, expired or not", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T09:00:00.000Z"));
    seedWorkspace({ observer: true });
    const port = createPort();
    const stale = await port.initiateOwnershipTransfer({
      actor: owner,
      workspaceId,
      targetPrincipalId: target.principalId,
      expectedRequestId: null,
      expectedRevision: null,
      command: command("initiate"),
    });
    if (stale.kind !== "applied") throw new Error("initiation did not apply");
    seeded()
      .prepare("UPDATE account_ownership_transfers SET createdAt = ?, expiresAt = ? WHERE id = ?")
      .run("2026-08-25T09:00:00.000Z", "2026-09-01T09:00:00.000Z", stale.request.id);

    await expect(
      port.initiateOwnershipTransfer({
        actor: owner,
        workspaceId,
        targetPrincipalId: observer.principalId,
        expectedRequestId: "a-request-that-is-not-live",
        expectedRevision: "7",
        command: command("second"),
      }),
    ).rejects.toMatchObject({ failure: { code: "CONFLICT" } });
    expect(readRequestById(seeded(), workspaceId, stale.request.id)).toMatchObject({ state: "awaiting_target" });
  });
});
