import { isApprovedEmailDomain } from "@capacitylens/shared/account/approvedDomains";
import type { JoiningPolicySettings } from "@capacitylens/shared/account/types";
import type { Membership } from "@capacitylens/shared/account/types";
import {
  getInvite,
  getMembershipRow,
  isAccessRestricted,
  inviteIsExpired,
  listMembershipsForUser,
  markInviteUsed,
  provenEmail,
  settleInvitationPersonProposal,
  upsertMember,
} from "../../controlTables";
import type { Invite } from "../../controlTables";
import { readJoiningPolicy } from "../../controlTables";
import type { Db } from "../../db";
import { createAccountFailure } from "./failures";
import { readMembership } from "./mappers";

interface AdmissionInput {
  db: Db;
  accountId: string;
  principalId: string;
  email: string;
  purpose: "policy" | "invitation";
  invitationToken?: string;
  now?: number;
}

type AdmissionTarget = Pick<AdmissionInput, "db" | "accountId" | "email" | "purpose" | "invitationToken" | "now">;

function resolveLiveInvite(input: AdmissionTarget, now: number): Invite | null {
  if (input.purpose !== "invitation") return null;
  const invite = input.invitationToken ? getInvite(input.db, input.invitationToken) : null;
  if (
    !invite ||
    invite.accountId !== input.accountId ||
    invite.preauthEmail !== input.email ||
    invite.usedAt !== null ||
    inviteIsExpired(invite.expiresAt, now)
  ) {
    throw createAccountFailure("INVITATION_EXPIRED", "This invitation is no longer available.");
  }
  return invite;
}

/** Preflight only; completion must call admitCompanyInTx to recheck current policy and proof. */
export function prepareCompanyAdmissionIntent(input: AdmissionTarget): Invite | null {
  const { db, accountId, email, purpose } = input;
  if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) {
    throw createAccountFailure("NOT_FOUND", "This company is unavailable.");
  }
  const invite = resolveLiveInvite(input, input.now ?? Date.now());
  assertPolicyAllows(readJoiningPolicy(db, accountId), purpose, email);
  return invite;
}

function assertPolicyAllows(settings: JoiningPolicySettings, purpose: AdmissionInput["purpose"], email: string): void {
  const domainApproved = isApprovedEmailDomain(email, settings.approvedDomains);
  if (purpose === "invitation") {
    if (settings.policy === "approved_domains" && !domainApproved) {
      throw createAccountFailure("FORBIDDEN", "This company only accepts approved email domains.");
    }
    return;
  }
  if (
    settings.policy === "invitation_only" ||
    ((settings.policy === "approved_domains" || settings.policy === "approved_domains_or_invitation") &&
      !domainApproved)
  ) {
    throw createAccountFailure("FORBIDDEN", "This company does not allow this address to join directly.");
  }
}

function applyMembership(input: AdmissionInput, invite: Invite | null, now: number): Membership {
  const { db, accountId, principalId } = input;
  const existing = getMembershipRow(db, accountId, principalId);
  if (existing?.status === "disabled") {
    throw createAccountFailure("FORBIDDEN", "An Owner or Admin must restore this membership.");
  }
  const role = existing?.status === "active" ? existing.role : (invite?.role ?? "viewer");
  if (!existing || existing.status === "archived") {
    upsertMember(db, {
      accountId,
      userId: principalId,
      role,
      status: "active",
      createdAt: new Date(now).toISOString(),
    });
  }
  const row = listMembershipsForUser(db, principalId).find((candidate) => candidate.accountId === accountId);
  if (!row) throw new Error("Company admission committed without a membership row.");
  return readMembership(db, row);
}

/** Caller owns one SQLite write transaction, including proof and intent consumption. */
export function admitCompanyInTx(input: AdmissionInput): Membership {
  const { db, accountId, principalId, email } = input;
  const now = input.now ?? Date.now();
  if (provenEmail(db, principalId) !== email) {
    throw createAccountFailure("FORBIDDEN", "The signed-in identity has not proved this mailbox.");
  }
  const invite = prepareCompanyAdmissionIntent(input);
  if (isAccessRestricted(db, accountId, principalId)) {
    throw createAccountFailure("FORBIDDEN", "Access to this company is disabled. Ask an administrator to enable it.");
  }
  const membership = applyMembership(input, invite, now);
  if (invite && input.invitationToken) {
    settleInvitationPersonProposal({
      db,
      invitationId: invite.id,
      accountId,
      userId: principalId,
      now: new Date(now).toISOString(),
    });
    markInviteUsed(db, input.invitationToken, new Date(now).toISOString());
  }
  return membership;
}
