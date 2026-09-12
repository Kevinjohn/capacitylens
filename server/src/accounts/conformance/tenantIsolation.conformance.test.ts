import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { OwnershipTransferRequest } from "@capacitylens/shared/account/ownershipTransfer";
import { OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS } from "@capacitylens/shared/account/ownershipTransferPolicy";
import type { Db } from "../../db";
import { ensureAccountBoundaryState } from "../state/schema";
import { ensureControlTables } from "../../controlTables";
import { runOwnershipTransfersV41 } from "../../controlTables/ownershipTransfersSchema";
import * as members from "../../controlTables/members";
import * as invites from "../../controlTables/invites";
import * as inviteRetention from "../../controlTables/inviteRetention";
import * as ownershipTransfers from "../../controlTables/ownershipTransfers";
import { newInviteId } from "../../controlTables/inviteTokens";
import type { AccountMember } from "../../controlTables/members.model";

/**
 * Every account-scoped control-table write stays inside its own account.
 *
 * Written after an ownership-transfer retention sweep shipped with no `accountId` in its `WHERE`
 * clause, deleting every company's terminal rows from inside a mutation holding one company's lock.
 * Nothing in the repository observed mutation SCOPE: `tenantIntegrity.ts` guards AppData product
 * tables, the schema assertions check columns and indexes, and `architecture.test.ts` decides which
 * modules may own raw control-table SQL — which is why it correctly admitted the defect.
 *
 * The probe that matters is the FOREIGN one: calling a mutator for account A with account B's
 * identifier, and asserting nothing was written. A test that merely invokes the mutator for its own
 * account and checks the other account is untouched passes even with the tenant predicate removed,
 * because the row is already uniquely keyed by id. Member cases therefore seed the SAME `userId` in
 * both accounts, so losing the account half of a composite key is observable.
 */

// Invented principals use comic-book character real names (AGENTS.md): Wayne Enterprises for the
// first company, Stark Industries for the second.
const WAYNE = "a-studio";
const STARK = "a-loft";
/** Deliberately a member of BOTH companies: the shared principal is what makes a lost `accountId`
 *  visible on every membership write. */
const SHARED = "u-bruce-wayne";
const NOW = "2026-09-01T09:00:00.000Z";
const LATER = "2026-09-08T09:00:00.000Z";

function freshDb(): Db {
  const db = new DatabaseSync(":memory:") as unknown as Db;
  ensureControlTables(db);
  ensureAccountBoundaryState(db);
  runOwnershipTransfersV41(db);
  return db;
}

function member(accountId: string, overrides: Partial<AccountMember> = {}): AccountMember {
  return { accountId, userId: SHARED, role: "admin", status: "active", createdAt: NOW, ...overrides };
}

function invite(accountId: string, id: string, token: string): invites.Invite {
  return {
    token,
    id,
    accountId,
    role: "editor",
    preauthEmail: null,
    expiresAt: LATER,
    usedAt: null,
    createdAt: NOW,
  };
}

function request(accountId: string, overrides: Partial<OwnershipTransferRequest> = {}): OwnershipTransferRequest {
  return {
    id: `ot-${accountId}`,
    accountId,
    initiatorUserId: SHARED,
    targetUserId: "u-selina-kyle",
    state: "awaiting_target",
    revision: "0",
    createdAt: NOW,
    expiresAt: LATER,
    targetAcceptedAt: null,
    terminalAt: null,
    terminalReason: null,
    ...overrides,
  };
}

/** Both companies seeded identically, so any assertion about one is an assertion about a real
 *  neighbour rather than an empty table. */
function seedBothCompanies(db: Db): void {
  for (const accountId of [WAYNE, STARK]) {
    members.upsertMember(db, member(accountId));
    invites.createInvite(db, invite(accountId, `inv-${accountId}`, `token-${accountId}`));
    ownershipTransfers.insertRequest(db, request(accountId));
  }
}

function membershipOf(db: Db, accountId: string) {
  return members.getMembershipRow(db, accountId, SHARED);
}

function inviteIds(db: Db, accountId: string): string[] {
  return inviteRetention.listInvitesForAccount(db, accountId).map((row) => row.id);
}

function transferStates(db: Db, accountId: string): Array<{ id: string; state: string }> {
  return (
    db
      .prepare(`SELECT id, state FROM account_ownership_transfers WHERE accountId = ? ORDER BY id`)
      .all(accountId) as Array<{ id: string; state: string }>
  ).map(({ id, state }) => ({ id, state }));
}

/** Everything about Stark Industries that a write addressed to Wayne Enterprises must not move. */
function starkSnapshot(db: Db) {
  return {
    membership: membershipOf(db, STARK),
    invites: inviteIds(db, STARK),
    transfers: transferStates(db, STARK),
  };
}

describe("control-table writes stay inside their account: membership", () => {
  it("upsertMember writes the account it is given and leaves the other company's row alone", () => {
    const db = freshDb();
    seedBothCompanies(db);
    const before = starkSnapshot(db);

    members.upsertMember(db, member(WAYNE, { role: "viewer" }));

    expect(membershipOf(db, WAYNE)?.role).toBe("viewer");
    // The same principal, in another company, at the role they held before.
    expect(membershipOf(db, STARK)?.role).toBe("admin");
    expect(starkSnapshot(db)).toEqual(before);
    db.close();
  });

  it("setMemberStatus reports missing for a principal who is a member of another company only", () => {
    const db = freshDb();
    members.upsertMember(db, member(STARK));

    const answer = members.setMemberStatus({ db, accountId: WAYNE, userId: SHARED, status: "disabled" });

    expect(answer.outcome).toBe("missing");
    expect(membershipOf(db, STARK)?.status).toBe("active");
    db.close();
  });

  it("removeMember addressed to the wrong company removes nothing", () => {
    const db = freshDb();
    seedBothCompanies(db);
    const before = starkSnapshot(db);

    // Wayne's administrator naming a principal who is also a Stark member: the membership they
    // may remove is Wayne's, and only Wayne's.
    members.removeMember(db, WAYNE, SHARED);

    expect(membershipOf(db, WAYNE)).toBeNull();
    expect(membershipOf(db, STARK)).not.toBeNull();
    expect(starkSnapshot(db).membership).toEqual(before.membership);
    db.close();
  });

  it("removeAllMembersForAccount empties one company", () => {
    const db = freshDb();
    seedBothCompanies(db);

    members.removeAllMembersForAccount(db, WAYNE);

    expect(members.listMembersForAccount(db, WAYNE)).toEqual([]);
    expect(members.listMembersForAccount(db, STARK)).toHaveLength(1);
    db.close();
  });
});

describe("control-table writes stay inside their account: invitations", () => {
  it("createInvite files the invite under the account it names", () => {
    const db = freshDb();
    seedBothCompanies(db);

    invites.createInvite(db, invite(WAYNE, newInviteId(), "token-second-wayne"));

    expect(inviteIds(db, WAYNE)).toHaveLength(2);
    expect(inviteIds(db, STARK)).toEqual([`inv-${STARK}`]);
    db.close();
  });

  it("revokeInvite refuses another company's invite id", () => {
    const db = freshDb();
    seedBothCompanies(db);

    // The id is unique on its own, so a revoke that had lost its accountId predicate would find
    // this row and delete it. That is the defect this case exists to catch.
    const removed = inviteRetention.revokeInvite(db, WAYNE, `inv-${STARK}`);

    expect(removed).toBe(0);
    expect(inviteIds(db, STARK)).toEqual([`inv-${STARK}`]);
    db.close();
  });

  it("removeAllInvitesForAccount empties one company", () => {
    const db = freshDb();
    seedBothCompanies(db);

    invites.removeAllInvitesForAccount(db, WAYNE);

    expect(inviteIds(db, WAYNE)).toEqual([]);
    expect(inviteIds(db, STARK)).toEqual([`inv-${STARK}`]);
    db.close();
  });
});

describe("control-table writes stay inside their account: ownership transfers", () => {
  it("insertRequest files the request under the account it names", () => {
    const db = freshDb();
    seedBothCompanies(db);

    expect(transferStates(db, WAYNE)).toEqual([{ id: `ot-${WAYNE}`, state: "awaiting_target" }]);
    expect(transferStates(db, STARK)).toEqual([{ id: `ot-${STARK}`, state: "awaiting_target" }]);
    db.close();
  });

  it("applyTransition refuses another company's request id", () => {
    const db = freshDb();
    seedBothCompanies(db);

    // `id` is the primary key, so a CAS that had lost its accountId predicate would move this row.
    const applied = ownershipTransfers.applyTransition({
      db,
      id: `ot-${STARK}`,
      accountId: WAYNE,
      expectedState: "awaiting_target",
      expectedRevision: "0",
      nextState: "awaiting_owner",
      nextRevision: "1",
      targetAcceptedAt: NOW,
      terminalAt: null,
      terminalReason: null,
    });

    expect(applied).toBe(false);
    expect(transferStates(db, STARK)).toEqual([{ id: `ot-${STARK}`, state: "awaiting_target" }]);
    db.close();
  });

  it("terminaliseLiveRequestsForAccount ends one company's requests", () => {
    const db = freshDb();
    seedBothCompanies(db);

    const ended = ownershipTransfers.terminaliseLiveRequestsForAccount({
      db,
      accountId: WAYNE,
      reason: "account_erased",
      now: NOW,
    });

    expect(ended).toEqual([`ot-${WAYNE}`]);
    expect(transferStates(db, STARK)).toEqual([{ id: `ot-${STARK}`, state: "awaiting_target" }]);
    db.close();
  });
});

describe("control-table writes stay inside their account: ending and bounding transfers", () => {
  it("terminaliseLiveRequestsForMember ends only the named company's request for a shared principal", () => {
    const db = freshDb();
    seedBothCompanies(db);

    const ended = ownershipTransfers.terminaliseLiveRequestsForMember({
      db,
      accountId: WAYNE,
      userId: SHARED,
      reason: "participant_membership_changed",
      now: NOW,
    });

    // The same principal initiates both requests: a predicate that matched on the user alone
    // would end a ceremony in a company whose membership did not change.
    expect(ended).toEqual([`ot-${WAYNE}`]);
    expect(transferStates(db, STARK)).toEqual([{ id: `ot-${STARK}`, state: "awaiting_target" }]);
    db.close();
  });

  it("deleteRequestsForAccount deletes one company's rows", () => {
    const db = freshDb();
    seedBothCompanies(db);

    ownershipTransfers.deleteRequestsForAccount(db, WAYNE);

    expect(transferStates(db, WAYNE)).toEqual([]);
    expect(transferStates(db, STARK)).toHaveLength(1);
    db.close();
  });

  it("sweepExpiredHistory bounds one company's history", () => {
    const db = freshDb();
    const now = Date.parse("2027-09-01T09:00:00.000Z");
    const longAgo = new Date(now - OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS - 1).toISOString();
    for (const accountId of [WAYNE, STARK]) {
      ownershipTransfers.insertRequest(
        db,
        request(accountId, { state: "declined", terminalAt: longAgo, terminalReason: "target_declined" }),
      );
    }

    expect(ownershipTransfers.sweepExpiredHistory(db, WAYNE, now)).toBe(1);
    expect(transferStates(db, STARK)).toHaveLength(1);
    db.close();
  });
});

/**
 * Every export of the four operational control-table modules is either exercised above or excluded
 * here with a reason.
 *
 * The inventory is the point: a new exported write appears in neither list, and this test fails
 * until somebody decides which it is. Reads, assertions and pure helpers cannot move another
 * company's rows; the token-keyed and migration operations are addressed by identity or run once
 * over the whole database, and keep their guarantees in their own focused tests.
 */
const COVERED = new Set([
  "upsertMember",
  "setMemberStatus",
  "removeMember",
  "removeAllMembersForAccount",
  "createInvite",
  "removeAllInvitesForAccount",
  "revokeInvite",
  "insertRequest",
  "applyTransition",
  "terminaliseLiveRequestsForAccount",
  "terminaliseLiveRequestsForMember",
  "deleteRequestsForAccount",
  "sweepExpiredHistory",
]);

const EXCLUDED: Record<string, string> = {
  // Reads and pure helpers: they return rows, they do not write them.
  getMembershipRow: "read",
  getMemberRole: "read",
  getActiveMemberRole: "read",
  listMembershipsForUser: "read",
  listMembersForAccount: "read",
  countActiveOwners: "read",
  listInvitesForAccount: "read",
  getInvite: "read",
  readLiveRequest: "read",
  readRequestById: "read",
  readLatestTerminalForParticipant: "read",
  inviteIsExpired: "pure helper",
  normalizeEmail: "pure helper",
  preauthInviteAllows: "pure helper",
  looksLikeEmail: "pure helper",
  nextOwnershipTransferRevision: "pure helper",
  // Addressed by a secret the holder already possesses, not by account.
  markInviteUsed: "token-keyed: the token IS the authorisation, and it names exactly one row",
  // Deliberately dual-mode. Its scoped-call guarantee is pinned in controlTables.test.ts, where the
  // unscoped maintenance mode is also exercised; claiming it here would overstate what this covers.
  pruneInvites: "dual-mode maintenance; scoped-call isolation pinned in its own tests",
  // An error class, not a write.
  InviteAlreadyUsedError: "error type",
  // One-time migrations run once over the whole database, by design.
  migrateUsedInvitationHistoryV24: "one-time migration over every account",
};

describe("the isolation inventory", () => {
  const modules = {
    members: members as Record<string, unknown>,
    invites: invites as Record<string, unknown>,
    inviteRetention: inviteRetention as Record<string, unknown>,
    ownershipTransfers: ownershipTransfers as Record<string, unknown>,
  };

  for (const [name, module] of Object.entries(modules)) {
    it(`classifies every export of ${name}`, () => {
      const unclassified = Object.keys(module)
        .filter((key) => typeof module[key] === "function")
        .filter((key) => !COVERED.has(key) && !(key in EXCLUDED));

      expect(unclassified).toEqual([]);
    });
  }

  it("keeps no stale entry in either list", () => {
    const exported = new Set(Object.values(modules).flatMap((module) => Object.keys(module)));
    const stale = [...COVERED, ...Object.keys(EXCLUDED)].filter((key) => !exported.has(key));

    expect(stale).toEqual([]);
  });
});
