import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { OwnershipTransferRequest } from "@capacitylens/shared/account/ownershipTransfer";
import { OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS } from "@capacitylens/shared/account/ownershipTransferPolicy";
import type { Db } from "../../db";
import { ensureAccountBoundaryState } from "../state/schema";
import { ensureControlTables } from "../../controlTables";
import { runOwnershipTransfersV41 } from "../../controlTables/ownershipTransfersSchema";
import * as assertions from "../../controlTables/assert";
import * as inviteRetention from "../../controlTables/inviteRetention";
import * as inviteTokens from "../../controlTables/inviteTokens";
import * as invites from "../../controlTables/invites";
import * as membersModel from "../../controlTables/members.model";
import * as members from "../../controlTables/members";
import * as ownershipMigrations from "../../controlTables/ownershipMigrations";
import * as ownershipTransfers from "../../controlTables/ownershipTransfers";
import * as ownershipTransfersSchema from "../../controlTables/ownershipTransfersSchema";
import * as preparedStatement from "../../controlTables/preparedStatement";
import * as retentionV24 from "../../controlTables/retentionV24";
import * as signInTracking from "../memberSignInTracking";
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
const NEWCOMER = "u-barbara-gordon";
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

function membershipOf(db: Db, accountId: string, userId: string = SHARED) {
  return members.getMembershipRow(db, accountId, userId);
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

/** The observation bit is not part of the mapped membership, and it is exactly what one company's
 *  privacy switch must never write into another's rows. */
function observationBits(db: Db, accountId: string): Array<{ userId: string; signInConfirmed: string | null }> {
  return (
    db
      .prepare(`SELECT userId, signInConfirmed FROM account_members WHERE accountId = ? ORDER BY userId`)
      .all(accountId) as Array<{ userId: string; signInConfirmed: string | null }>
  ).map(({ userId, signInConfirmed }) => ({ userId, signInConfirmed: signInConfirmed ?? null }));
}

function trackingAccounts(db: Db): string[] {
  return (
    db.prepare(`SELECT accountId FROM account_member_sign_in_tracking ORDER BY accountId`).all() as Array<{
      accountId: string;
    }>
  ).map(({ accountId }) => accountId);
}

/** Everything about Stark Industries that a write addressed to Wayne Enterprises must not move. */
function starkSnapshot(db: Db) {
  return {
    membership: membershipOf(db, STARK),
    observation: observationBits(db, STARK),
    invites: inviteIds(db, STARK),
    transfers: transferStates(db, STARK),
    tracking: trackingAccounts(db).includes(STARK),
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

  it("upsertMember reads the sign-in tracking opt-in of the account it writes, not of any account", () => {
    const db = freshDb();
    seedBothCompanies(db);
    // Wayne Enterprises alone opts in to sign-in tracking.
    signInTracking.setMemberSignInTracking({ db, accountId: WAYNE, actorPrincipalId: SHARED, enabled: true });

    members.upsertMember(db, member(WAYNE, { userId: NEWCOMER, role: "editor" }));
    members.upsertMember(db, member(STARK, { userId: NEWCOMER, role: "editor" }));

    // The observation column is stamped from a correlated EXISTS over the tracking table. If that
    // subquery lost its accountId, Stark's newcomer would be stamped 'false' — a "never signed in"
    // flag on a company that never turned tracking on, written by another company's switch.
    expect(observationBits(db, WAYNE)).toContainEqual({ userId: NEWCOMER, signInConfirmed: "false" });
    expect(observationBits(db, STARK)).toEqual([
      { userId: NEWCOMER, signInConfirmed: null },
      { userId: SHARED, signInConfirmed: null },
    ]);
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
    expect(starkSnapshot(db)).toEqual(before);
    db.close();
  });

  it("removeAllMembersForAccount empties one company and touches nothing of the other", () => {
    const db = freshDb();
    seedBothCompanies(db);
    signInTracking.setMemberSignInTracking({ db, accountId: STARK, actorPrincipalId: SHARED, enabled: true });
    const before = starkSnapshot(db);

    members.removeAllMembersForAccount(db, WAYNE);

    expect(members.listMembersForAccount(db, WAYNE)).toEqual([]);
    // The whole snapshot, because this erasure also removes sign-in tracking and ends live
    // transfers: an unscoped predicate in either callee would take Stark's with it.
    expect(starkSnapshot(db)).toEqual(before);
    db.close();
  });
});

describe("control-table writes stay inside their account: sign-in tracking", () => {
  it("setMemberSignInTracking switches one company's observation on", () => {
    const db = freshDb();
    seedBothCompanies(db);
    const before = starkSnapshot(db);

    signInTracking.setMemberSignInTracking({ db, accountId: WAYNE, actorPrincipalId: SHARED, enabled: true });

    expect(observationBits(db, WAYNE)).toEqual([{ userId: SHARED, signInConfirmed: "true" }]);
    expect(starkSnapshot(db)).toEqual(before);
    db.close();
  });

  it("setMemberSignInTracking switches one company's observation off", () => {
    const db = freshDb();
    seedBothCompanies(db);
    for (const accountId of [WAYNE, STARK]) {
      signInTracking.setMemberSignInTracking({ db, accountId, actorPrincipalId: SHARED, enabled: true });
    }

    signInTracking.setMemberSignInTracking({ db, accountId: WAYNE, actorPrincipalId: SHARED, enabled: false });

    expect(observationBits(db, WAYNE)).toEqual([{ userId: SHARED, signInConfirmed: null }]);
    expect(observationBits(db, STARK)).toEqual([{ userId: SHARED, signInConfirmed: "true" }]);
    expect(trackingAccounts(db)).toEqual([STARK]);
    db.close();
  });

  it("removeMemberSignInTrackingForAccount removes one company's opt-in", () => {
    const db = freshDb();
    seedBothCompanies(db);
    for (const accountId of [WAYNE, STARK]) {
      signInTracking.setMemberSignInTracking({ db, accountId, actorPrincipalId: SHARED, enabled: true });
    }

    signInTracking.removeMemberSignInTrackingForAccount(db, WAYNE);

    expect(trackingAccounts(db)).toEqual([STARK]);
    db.close();
  });
});

describe("control-table writes stay inside their account: invitations", () => {
  it("createInvite files the invite under the account it names", () => {
    const db = freshDb();
    seedBothCompanies(db);

    invites.createInvite(db, invite(WAYNE, inviteTokens.newInviteId(), "token-second-wayne"));

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
    members.upsertMember(db, member(STARK));
    ownershipTransfers.insertRequest(db, request(STARK));

    ownershipTransfers.insertRequest(db, request(WAYNE));

    expect(transferStates(db, WAYNE)).toEqual([{ id: `ot-${WAYNE}`, state: "awaiting_target" }]);
    // The live slot is per company: the partial unique index must not have refused Wayne's request
    // because another company already holds one, and Stark's must still read as Stark's.
    expect(ownershipTransfers.readLiveRequest(db, STARK)?.id).toBe(`ot-${STARK}`);
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
 * The inventory: every export of every control-table module is classified, and every classification
 * that claims coverage is backed by a case above that still calls it.
 *
 * Keyed by `module.export` rather than by bare name, because two modules may export the same name
 * and one module's decision must never silently classify another module's function.
 */
const MODULES: Record<string, Record<string, unknown>> = {
  assert: assertions,
  inviteRetention,
  inviteTokens,
  invites,
  members,
  "members.model": membersModel,
  ownershipMigrations,
  ownershipTransfers,
  ownershipTransfersSchema,
  preparedStatement,
  retentionV24,
  // Not under controlTables/, but it writes `account_members` and owns the per-account tracking
  // table, so it is the same surface and belongs to the same inventory.
  memberSignInTracking: signInTracking,
};

/** The modules whose files live in `controlTables/`. Kept separate so the directory check below can
 *  compare like with like. */
const CONTROL_TABLE_MODULES = Object.keys(MODULES).filter((name) => name !== "memberSignInTracking");

const COVERED = new Set([
  "members.upsertMember",
  "members.setMemberStatus",
  "members.removeMember",
  "members.removeAllMembersForAccount",
  "memberSignInTracking.setMemberSignInTracking",
  "memberSignInTracking.removeMemberSignInTrackingForAccount",
  "invites.createInvite",
  "invites.removeAllInvitesForAccount",
  "inviteRetention.revokeInvite",
  "ownershipTransfers.insertRequest",
  "ownershipTransfers.applyTransition",
  "ownershipTransfers.terminaliseLiveRequestsForAccount",
  "ownershipTransfers.terminaliseLiveRequestsForMember",
  "ownershipTransfers.deleteRequestsForAccount",
  "ownershipTransfers.sweepExpiredHistory",
]);

/** Why each remaining export cannot carry one company's rows out of its own account. */
const EXCLUDED = new Map<string, string>([
  ["members.getMembershipRow", "read"],
  ["members.getMemberRole", "read"],
  ["members.getActiveMemberRole", "read"],
  ["members.listMembershipsForUser", "read"],
  ["members.listMembersForAccount", "read"],
  ["members.countActiveOwners", "read"],
  ["members.model.toAccountMember", "row mapper"],
  ["members.model.isKnownRole", "pure helper"],
  ["inviteRetention.listInvitesForAccount", "read"],
  ["inviteRetention.inviteIsExpired", "pure helper"],
  ["invites.getInvite", "read"],
  ["invites.normalizeEmail", "pure helper"],
  ["invites.preauthInviteAllows", "pure helper"],
  ["invites.looksLikeEmail", "pure helper"],
  ["invites.InviteAlreadyUsedError", "error type"],
  ["inviteTokens.inviteTokenHash", "pure helper"],
  ["inviteTokens.newInviteId", "pure helper"],
  ["ownershipTransfers.readLiveRequest", "read"],
  ["ownershipTransfers.readRequestById", "read"],
  ["ownershipTransfers.readLatestTerminalForParticipant", "read"],
  ["ownershipTransfers.nextOwnershipTransferRevision", "pure helper"],
  ["ownershipTransfersSchema.toOwnershipTransferRequest", "row mapper"],
  ["ownershipTransfersSchema.assertOwnershipTransfersCurrent", "schema assertion"],
  ["ownershipTransfersSchema.runOwnershipTransfersV41", "schema installer"],
  ["preparedStatement.cachedStatement", "statement cache; carries no SQL of its own"],
  ["assert.assertControlTablesCurrent", "schema assertion"],
  ["assert.assertSingleOwnerControlPlaneV10", "schema assertion"],
  ["assert.assertSingleOwnerControlPlaneCurrent", "schema assertion"],
  ["retentionV24.ensureControlTables", "schema installer"],
  ["memberSignInTracking.readMemberSignInTrackingSnapshot", "read"],
  ["memberSignInTracking.migrateMemberSignInTrackingV26", "one-time migration over every account"],
  ["memberSignInTracking.assertMemberSignInTrackingSchemaCurrent", "schema assertion"],
  // Identity-keyed by design: one sign-in, or one deliberate access reset, is a fact about the
  // principal in EVERY company that opted in, so these cross accounts on purpose. Their per-account
  // opt-in correlation is covered in memberSignInTracking's own tests.
  ["memberSignInTracking.confirmTrackedMemberSignIn", "identity-keyed across every opted-in account"],
  ["memberSignInTracking.clearTrackedMemberSignIn", "identity-keyed across every opted-in account"],
  // Deliberately dual-mode. Its scoped-call isolation is pinned in controlTables.test.ts, where the
  // unscoped maintenance mode is exercised too; claiming it here would overstate this suite.
  ["inviteRetention.pruneInvites", "dual-mode maintenance; scoped-call isolation pinned in its own tests"],
  ["inviteRetention.migrateUsedInvitationHistoryV24", "one-time migration over every account"],
  ["ownershipMigrations.migrateSingleOwnerControlPlaneV10", "one-time migration over every account"],
  ["ownershipMigrations.migrateOwnerlessControlPlaneV11", "one-time migration over every account"],
  ["ownershipMigrations.migrateOwnerResetCeremoniesV12", "one-time migration over every account"],
  ["ownershipMigrations.migrateMemberResetCeremoniesV14", "one-time migration over every account"],
  ["ownershipMigrations.reportOwnerlessPromotionsV11", "read"],
  ["invites.markInviteUsed", "token-keyed: the token IS the authorisation, and it names exactly one row"],
  // Values, not operations: SQL text, index names and policy numbers. They cannot write anything;
  // the statements built from them are classified at the function that runs them.
  ["assert.SINGLE_OWNER_INDEX", "index name"],
  ["memberSignInTracking.MEMBER_SIGN_IN_TRACKING_V26_DEFINITION", "schema definition"],
  ["ownershipTransfersSchema.OWNERSHIP_TRANSFER_REQUESTS_V41_SQL", "schema definition"],
  ["ownershipTransfersSchema.OWNERSHIP_TRANSFER_LIVE_INDEX", "index name"],
  ["ownershipTransfersSchema.OWNERSHIP_TRANSFER_TARGET_INDEX", "index name"],
  ["ownershipTransfersSchema.LIVE_STATES_PREDICATE", "SQL fragment"],
  ["ownershipTransfersSchema.SELECTED_COLUMNS", "SQL fragment"],
  ["retentionV24.INVITATION_RETENTION_INDEXES_V24_SQL", "schema definition"],
  ["retentionV24.USED_INVITATION_RETENTION_V24_DEFINITION", "schema definition"],
  ["retentionV24.USED_INVITATION_RETENTION_LIMIT", "retention policy value"],
  ["retentionV24.USED_INVITATION_RETENTION_MS", "retention policy value"],
]);

describe("the isolation inventory", () => {
  it("reflects over every module in controlTables/", () => {
    // Read from disk rather than trusting the import list: a NEW control-table module is the
    // easiest way for an unscoped write to arrive unclassified.
    const onDisk = readdirSync(new URL("../../controlTables/", import.meta.url))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => file.replace(/\.ts$/, ""))
      .sort();

    expect([...CONTROL_TABLE_MODULES].sort()).toEqual(onDisk);
  });

  for (const [name, module] of Object.entries(MODULES)) {
    it(`classifies every export of ${name}`, () => {
      // Every export, not only the functions: a writer exported as an object of operations, or
      // built by a factory, is still a writer, and filtering by type would drop it before the check.
      const unclassified = Object.keys(module)
        .map((key) => `${name}.${key}`)
        .filter((key) => !COVERED.has(key) && !EXCLUDED.has(key));

      expect(unclassified).toEqual([]);
    });
  }

  it("keeps no stale entry in either collection", () => {
    const exported = new Set(
      Object.entries(MODULES).flatMap(([name, module]) => Object.keys(module).map((key) => `${name}.${key}`)),
    );
    const stale = [...COVERED, ...EXCLUDED.keys()].filter((key) => !exported.has(key));

    expect(stale).toEqual([]);
  });

  it("backs every covered mutator with a case that still calls it", () => {
    // The set above only CLAIMS coverage; this proves it. Without it, deleting or renaming a case
    // leaves the inventory certifying isolation that nothing tests any more — worse than no
    // inventory at all, because a reader who sees the name stops looking.
    const source = readFileSync(new URL(import.meta.url), "utf8");
    const cases = source.slice(0, source.indexOf("const MODULES:"));
    const uncalled = [...COVERED].filter((key) => !cases.includes(`.${key.split(".").at(-1)}(`));

    expect(uncalled).toEqual([]);
  });
});
