import { randomBytes } from "node:crypto";
import type { Db } from "../db";

/** Bounded, current-only reasons for a proposal that could not become a live link. */
export type MemberResourceLinkExceptionReason =
  "resource_unavailable" | "resource_already_linked" | "member_already_linked";

export const INVITATION_PERSON_PROPOSALS_SQL = `
CREATE TABLE IF NOT EXISTS invitation_person_proposals (
  invitationId TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL,
  resourceId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitation_person_proposals_accountId
  ON invitation_person_proposals(accountId);
CREATE TABLE IF NOT EXISTS member_resource_link_exceptions (
  accountId TEXT NOT NULL,
  userId TEXT NOT NULL,
  proposedResourceId TEXT,
  reason TEXT NOT NULL CHECK(reason IN ('resource_unavailable', 'resource_already_linked', 'member_already_linked')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (accountId, userId)
);
CREATE INDEX IF NOT EXISTS idx_member_resource_link_exceptions_accountId
  ON member_resource_link_exceptions(accountId);
`;

export interface InvitationPersonProposal {
  invitationId: string;
  accountId: string;
  resourceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemberResourceLinkException {
  accountId: string;
  userId: string;
  proposedResourceId: string | null;
  reason: MemberResourceLinkExceptionReason;
  createdAt: string;
  updatedAt: string;
}

interface ProposalInput {
  db: Db;
  invitationId: string;
  accountId: string;
  resourceId: string;
  now: string;
}

function newAssociationRevision(): string {
  return randomBytes(16).toString("base64url");
}

/** Return whether a resource can be proposed without reserving it. */
export function isEligibleInvitationPerson(db: Db, accountId: string, resourceId: string): boolean {
  const row = db
    .prepare(`SELECT kind, archivedAt, deletedAt FROM resources WHERE accountId = ? AND id = ?`)
    .get(accountId, resourceId) as { kind: string; archivedAt: string | null; deletedAt: string | null } | undefined;
  return row?.kind === "person" && row.archivedAt === null && row.deletedAt === null;
}

/** Persist a proposal after the caller has validated its account-scoped eligibility. */
export function createInvitationPersonProposal(input: ProposalInput): void {
  if (!isEligibleInvitationPerson(input.db, input.accountId, input.resourceId)) {
    const error = new Error("The selected scheduled person is no longer available.");
    error.name = "InvitationPersonProposalConflict";
    throw error;
  }
  input.db
    .prepare(
      `INSERT INTO invitation_person_proposals (invitationId, accountId, resourceId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.invitationId, input.accountId, input.resourceId, input.now, input.now);
}

export function getInvitationPersonProposal(db: Db, invitationId: string): InvitationPersonProposal | null {
  const row = db
    .prepare(
      `SELECT invitationId, accountId, resourceId, createdAt, updatedAt
         FROM invitation_person_proposals WHERE invitationId = ?`,
    )
    .get(invitationId) as InvitationPersonProposal | undefined;
  return row ?? null;
}

export function listInvitationPersonProposals(db: Db, accountId: string): InvitationPersonProposal[] {
  return db
    .prepare(
      `SELECT invitationId, accountId, resourceId, createdAt, updatedAt
         FROM invitation_person_proposals WHERE accountId = ? ORDER BY createdAt, invitationId`,
    )
    .all(accountId) as unknown as InvitationPersonProposal[];
}

export function removeInvitationPersonProposal(db: Db, invitationId: string): void {
  db.prepare(`DELETE FROM invitation_person_proposals WHERE invitationId = ?`).run(invitationId);
}

export function removeInvitationPersonProposalsForAccount(db: Db, accountId: string): void {
  db.prepare(`DELETE FROM invitation_person_proposals WHERE accountId = ?`).run(accountId);
}

export function removeInvitationPersonProposalsForResource(db: Db, accountId: string, resourceId: string): void {
  db.prepare(`DELETE FROM invitation_person_proposals WHERE accountId = ? AND resourceId = ?`).run(
    accountId,
    resourceId,
  );
}

export function listMemberResourceLinkExceptions(db: Db, accountId: string): MemberResourceLinkException[] {
  return db
    .prepare(
      `SELECT accountId, userId, proposedResourceId, reason, createdAt, updatedAt
         FROM member_resource_link_exceptions WHERE accountId = ? ORDER BY userId`,
    )
    .all(accountId) as unknown as MemberResourceLinkException[];
}

export function getMemberResourceLinkException(
  db: Db,
  accountId: string,
  userId: string,
): MemberResourceLinkException | null {
  const row = db
    .prepare(
      `SELECT accountId, userId, proposedResourceId, reason, createdAt, updatedAt
         FROM member_resource_link_exceptions WHERE accountId = ? AND userId = ?`,
    )
    .get(accountId, userId) as MemberResourceLinkException | undefined;
  return row ?? null;
}

export function upsertMemberResourceLinkException(input: {
  db: Db;
  accountId: string;
  userId: string;
  proposedResourceId: string | null;
  reason: MemberResourceLinkExceptionReason;
  now: string;
}): void {
  input.db
    .prepare(
      `INSERT INTO member_resource_link_exceptions
         (accountId, userId, proposedResourceId, reason, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, userId) DO UPDATE SET
         proposedResourceId = excluded.proposedResourceId,
         reason = excluded.reason,
         updatedAt = excluded.updatedAt`,
    )
    .run(input.accountId, input.userId, input.proposedResourceId, input.reason, input.now, input.now);
}

export function removeMemberResourceLinkException(db: Db, accountId: string, userId: string): void {
  db.prepare(`DELETE FROM member_resource_link_exceptions WHERE accountId = ? AND userId = ?`).run(accountId, userId);
}

export function removeMemberResourceLinkExceptionsForAccount(db: Db, accountId: string): void {
  db.prepare(`DELETE FROM member_resource_link_exceptions WHERE accountId = ?`).run(accountId);
}

export function removeMemberResourceLinkExceptionsForResource(db: Db, accountId: string, resourceId: string): void {
  db.prepare(
    `DELETE FROM member_resource_link_exceptions
         WHERE accountId = ? AND proposedResourceId = ?`,
  ).run(accountId, resourceId);
}

/**
 * Settle one proposal inside the invitation admission transaction. Expected target occupancy and
 * eligibility outcomes are represented by the current exception row; storage and integrity errors
 * deliberately escape so the enclosing membership claim rolls back.
 */
// eslint-disable-next-line max-lines-per-function
export function settleInvitationPersonProposal(input: {
  db: Db;
  invitationId: string;
  accountId: string;
  userId: string;
  now: string;
}): void {
  const proposal = getInvitationPersonProposal(input.db, input.invitationId);
  if (!proposal) return;
  if (proposal.accountId !== input.accountId) {
    throw new Error("Invitation proposal account scope is corrupt.");
  }
  const existing = input.db
    .prepare(`SELECT resourceId FROM account_member_resources WHERE accountId = ? AND userId = ?`)
    .get(input.accountId, input.userId) as { resourceId: string } | undefined;
  if (existing?.resourceId === proposal.resourceId) {
    removeMemberResourceLinkException(input.db, input.accountId, input.userId);
  } else if (existing) {
    upsertMemberResourceLinkException({
      db: input.db,
      accountId: input.accountId,
      userId: input.userId,
      proposedResourceId: proposal.resourceId,
      reason: "member_already_linked",
      now: input.now,
    });
  } else if (!isEligibleInvitationPerson(input.db, input.accountId, proposal.resourceId)) {
    upsertMemberResourceLinkException({
      db: input.db,
      accountId: input.accountId,
      userId: input.userId,
      proposedResourceId: proposal.resourceId,
      reason: "resource_unavailable",
      now: input.now,
    });
  } else {
    try {
      input.db
        .prepare(
          `INSERT INTO account_member_resources (accountId, userId, resourceId, revision, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.accountId, input.userId, proposal.resourceId, newAssociationRevision(), input.now, input.now);
      removeMemberResourceLinkException(input.db, input.accountId, input.userId);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "";
      if (
        !detail.includes(
          "UNIQUE constraint failed: account_member_resources.accountId, account_member_resources.resourceId",
        )
      ) {
        throw cause;
      }
      upsertMemberResourceLinkException({
        db: input.db,
        accountId: input.accountId,
        userId: input.userId,
        proposedResourceId: proposal.resourceId,
        reason: "resource_already_linked",
        now: input.now,
      });
    }
  }
  removeInvitationPersonProposal(input.db, input.invitationId);
}
