import { isApprovedEmailDomain } from "@capacitylens/shared/account/approvedDomains";
import type { JoiningPolicySettings } from "@capacitylens/shared/account/types";
import type { Membership } from "@capacitylens/shared/account/types";
import { getInvite, markInviteUsed, getInviteTargetById, type Invite } from "../../controlTables/invites";
import { getMembershipRow, listMembershipsForUser, upsertMember } from "../../controlTables/members";
import { isAccessRestricted, provenEmail } from "../../controlTables/accessRestrictions";
import { inviteIsExpired } from "../../controlTables/inviteRetention";
import { settleInvitationPersonProposal } from "../../controlTables/invitationPersonProposals";
import { readJoiningPolicy } from "../../controlTables/joiningPolicies";
import type { Db } from "../../db";
import { tx } from "../../txn";
import { cancelJoinIntent, readJoinIntent, type JoinIntent } from "../../controlTables/joiningIntents";
import { hashJoiningValue, joiningCookieNames, readJoiningCookie } from "./joiningIntentSecrets";
import { confirmTrackedMemberSignIn } from "../memberSignInTracking";
import { enqueueAudit } from "../../auditOutbox";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { createAccountFailure } from "./failures";
import { readMembership } from "./mappers";

interface AdmissionInput {
  db: Db;
  applicationId: string;
  admissionId: string;
  confirmedSignIn: boolean;
  accountId: string;
  principalId: string;
  email: string;
  purpose: "policy" | "invitation";
  invitationToken?: string;
  now?: number;
}

type AdmissionTarget = Pick<AdmissionInput, "db" | "accountId" | "email" | "purpose" | "invitationToken" | "now">;

/** Keep an Owner's proven address from crossing a disabled-access boundary. */
export function hasProofOwnerRestrictionConflict(db: Db, principalId: string, email: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM account_members AS member
    JOIN account_access_restrictions AS restriction ON restriction.accountId = member.accountId
    WHERE member.userId = ? AND member.role = 'owner' AND member.status = 'active'
      AND (restriction.principalId = ? OR restriction.verifiedEmail = ?) LIMIT 1`,
      )
      .get(principalId, principalId, email),
  );
}

export function cancelCompanyJoinForBrowser(input: {
  db: Db;
  headers: Headers;
  applicationId: string;
  secureCookies: boolean;
  now: number;
}): void {
  const { db, headers, applicationId, secureCookies, now } = input;
  const names = joiningCookieNames(applicationId, secureCookies);
  const nonce = readJoiningCookie(headers, names.intent);
  const browser = readJoiningCookie(headers, names.browser);
  if (!nonce || !browser) return;
  const nonceHash = hashJoiningValue("nonce", nonce);
  const current = readJoinIntent(db, nonceHash);
  if (current?.browserHash === hashJoiningValue("browser", browser)) cancelJoinIntent(db, nonceHash, now);
}

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

/** Recheck a callback-bound target without reconstructing or exposing its invitation bearer. */
export function assertJoinIntentTargetLive(
  db: Db,
  intent: Pick<JoinIntent, "accountId" | "email" | "purpose" | "invitationId">,
  now = Date.now(),
): void {
  if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(intent.accountId)) {
    throw createAccountFailure("NOT_FOUND", "This company is unavailable.");
  }
  assertPolicyAllows(readJoiningPolicy(db, intent.accountId), intent.purpose, intent.email);
  if (intent.purpose === "invitation") {
    const invite = getInviteTargetById(db, intent.invitationId);
    if (
      !invite ||
      invite.accountId !== intent.accountId ||
      invite.preauthEmail !== intent.email ||
      invite.usedAt !== null ||
      inviteIsExpired(invite.expiresAt, now)
    ) {
      throw createAccountFailure("INVITATION_EXPIRED", "This invitation is no longer available.");
    }
  }
}

export function assertPolicyAllows(
  settings: JoiningPolicySettings,
  purpose: AdmissionInput["purpose"],
  email: string,
): void {
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
  if (input.confirmedSignIn) confirmTrackedMemberSignIn(db, principalId);
  if (invite && input.invitationToken) {
    settleInvitationPersonProposal({
      db,
      invitationId: invite.id,
      accountId,
      userId: principalId,
      now: new Date(now).toISOString(),
    });
    markInviteUsed(db, input.invitationToken, new Date(now).toISOString());
    const event: AccountAuditEvent = {
      id: `${input.admissionId}:invitation.accepted:success`,
      occurredAt: new Date(now).toISOString(),
      applicationId: input.applicationId,
      workspaceId: accountId,
      actorPrincipalId: principalId,
      targetPrincipalId: principalId,
      commandId: input.admissionId,
      action: "invitation.accepted",
      outcome: "success",
      changedFields: ["membership"],
    };
    enqueueAudit(db, event, event.id);
  }
  return membership;
}

/** Existing password sessions may use only their current durable proof for policy admission. */
export function completeExistingPolicyJoin(input: {
  db: Db;
  applicationId: string;
  accountId: string;
  principalId: string;
  admissionId: string;
}): { accountId: string; role: Membership["role"] } {
  const { db, applicationId, accountId, principalId, admissionId } = input;
  return tx(
    db,
    () => {
      const email = provenEmail(db, principalId);
      if (!email)
        throw createAccountFailure("AUTHENTICATION_REQUIRED", "This identity needs current email proof to join.");
      const membership = admitCompanyInTx({
        db,
        applicationId,
        admissionId,
        confirmedSignIn: true,
        accountId,
        principalId,
        email,
        purpose: "policy",
      });
      return { accountId, role: membership.role };
    },
    "immediate",
  );
}
