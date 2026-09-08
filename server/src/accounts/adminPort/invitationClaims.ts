import type { CommandIdentity, Membership } from "@capacitylens/shared/account/types";
import { createHash } from "node:crypto";
import {
  getInvite,
  getMembershipRow,
  InviteAlreadyUsedError,
  inviteIsExpired,
  listMembershipsForUser,
  markInviteUsed,
  preauthInviteAllows,
  pruneInvites,
  upsertMember,
} from "../../controlTables";
import { markAccountCommandReplay, resumeExistingCommand } from "../commands";
import { confirmTrackedMemberSignIn } from "../memberSignInTracking";
import { assertWorkspaceExists } from "./authority";
import type { AdminPortContext } from "./contracts";
import type { SsoCutoverAccountAdminPort } from "./contracts";
import { assertRedeemableInvitationRole, createAccountFailure } from "./failures";
import { readMembership } from "./mappers";

export function createHashForToken(token: string): string {
  return createHash("sha256").update("account-command-invite\0").update(token).digest("hex");
}

type InvitationClaimContext = Pick<
  AdminPortContext,
  "applicationId" | "db" | "trustedLocal" | "invitationSecretReplay" | "runMutation"
>;
type ClaimInvitationInput = {
  token: string;
  principalId: string;
  principalEmail: string;
  emailVerified: boolean;
  passwordMode: boolean;
  command: CommandIdentity;
};
type AcceptInvitationInput = Parameters<SsoCutoverAccountAdminPort["acceptInvitation"]>[0];
type PrincipalInvitationInput = Parameters<SsoCutoverAccountAdminPort["claimInvitationForPrincipal"]>[0];

function getRedeemableInvitation(context: InvitationClaimContext, input: ClaimInvitationInput) {
  const live = getInvite(context.db, input.token);
  if (!live) throw createAccountFailure("NOT_FOUND", "Invite not found.", input.command.commandId);
  if (live.usedAt !== null) {
    throw createAccountFailure("INVITATION_USED", "This invite has already been used.", input.command.commandId);
  }
  if (inviteIsExpired(live.expiresAt)) {
    throw createAccountFailure("INVITATION_EXPIRED", "This invite has expired.", input.command.commandId);
  }
  assertRedeemableInvitationRole(live.role, input.command.commandId);
  assertWorkspaceExists(context.db, live.accountId);
  if (
    !context.trustedLocal &&
    !preauthInviteAllows({
      preauthEmail: live.preauthEmail,
      user: { email: input.principalEmail, emailVerified: input.emailVerified },
      passwordMode: input.passwordMode,
    })
  ) {
    throw createAccountFailure(
      "INVITATION_EMAIL_MISMATCH",
      "This invite is reserved for a different identity.",
      input.command.commandId,
    );
  }
  return live;
}

function claimInvitation(context: InvitationClaimContext, input: ClaimInvitationInput): Membership {
  const live = getRedeemableInvitation(context, input);
  const now = new Date().toISOString();
  // Status-AGNOSTIC on purpose. An active-only probe reports a disabled or archived member as a
  // NON-member, and the branch below would then upsert them back to `status: "active"` at the
  // invite's role — silently reversing an administrator's decision, with no member.status_changed
  // audit record, for anyone who still holds (or is handed) a link-only invite. A non-active
  // membership is restored by an administrator through changeMemberStatus, never by its holder.
  const existing = getMembershipRow(context.db, live.accountId, input.principalId);
  if (existing && existing.status !== "active") {
    throw createAccountFailure(
      "FORBIDDEN",
      // Covers disabled AND archived, so it names neither: the person redeeming the link has no
      // business knowing which, and an inaccurate "disabled" on an archived row would be worse.
      "This membership is no longer active. An Owner or Admin must restore it before you can rejoin.",
      input.command.commandId,
    );
  }
  const effectiveRole = existing?.role ?? live.role;
  if (!existing) {
    upsertMember(context.db, {
      accountId: live.accountId,
      userId: input.principalId,
      role: effectiveRole,
      status: "active",
      createdAt: now,
    });
  }
  // Invitation acceptance itself runs only for the verified/authenticated principal. If the
  // membership is created after its session, the session hook could not have observed this
  // account yet, so confirm it inside the same invitation transaction.
  confirmTrackedMemberSignIn(context.db, input.principalId);
  try {
    markInviteUsed(context.db, input.token, now);
  } catch (error) {
    if (error instanceof InviteAlreadyUsedError) {
      throw createAccountFailure("INVITATION_USED", "This invite has already been used.", input.command.commandId);
    }
    throw error;
  }
  pruneInvites(context.db, Date.parse(now), live.accountId);
  const row = listMembershipsForUser(context.db, input.principalId).find(
    (candidate) => candidate.accountId === live.accountId,
  );
  if (!row) throw new Error("Invitation claim committed without a membership row.");
  return readMembership(context.db, row);
}

async function acceptInvitation(context: InvitationClaimContext, input: AcceptInvitationInput) {
  const { actor, token, principalEmail, emailVerified, command } = input;
  const passwordMode = actor.assurance === "password" || actor.assurance === "mfa";
  const operation = `accept-invitation:actor:${actor.principalId}`;
  const payload = { tokenHash: createHashForToken(token), passwordMode };
  const resumed = resumeExistingCommand<Membership>({
    db: context.db,
    scope: { applicationId: context.applicationId, operation, actorPrincipalId: actor.principalId },
    command,
    canonicalPayload: payload,
  });
  if (resumed) return markAccountCommandReplay(resumed.result);
  const invite = getInvite(context.db, token);
  if (!invite) throw createAccountFailure("NOT_FOUND", "Invite not found.", command.commandId);
  return context.runMutation({
    operation: "accept-invitation",
    actorPrincipalId: actor.principalId,
    targetPrincipalId: actor.principalId,
    workspaceId: invite.accountId,
    command,
    payload,
    lockKeys: [actor.principalId, `workspace:${invite.accountId}`],
    audit: { action: "invitation.accepted", changedFields: ["membership"] },
    afterCommit: () => {
      context.invitationSecretReplay.deleteWhere((invitation) => invitation.token === token);
    },
    execute: () =>
      claimInvitation(context, {
        token,
        principalId: actor.principalId,
        principalEmail,
        emailVerified,
        passwordMode,
        command,
      }),
  });
}

async function claimInvitationForPrincipal(context: InvitationClaimContext, input: PrincipalInvitationInput) {
  const { token, principalId, principalEmail, emailVerified, passwordMode, command } = input;
  const payload = { tokenHash: createHashForToken(token), principalId, principalEmail, emailVerified, passwordMode };
  const resumed = resumeExistingCommand<Membership>({
    db: context.db,
    scope: { applicationId: context.applicationId, operation: "claim-invitation", actorPrincipalId: null },
    command,
    canonicalPayload: payload,
  });
  if (resumed) return markAccountCommandReplay(resumed.result);
  const invite = getInvite(context.db, token);
  if (!invite) throw createAccountFailure("NOT_FOUND", "Invite not found.", command.commandId);
  return context.runMutation({
    operation: "claim-invitation",
    actorPrincipalId: null,
    targetPrincipalId: principalId,
    workspaceId: invite.accountId,
    command,
    payload,
    lockKeys: [principalId, `workspace:${invite.accountId}`],
    audit: { action: "invitation.accepted", changedFields: ["membership"] },
    afterCommit: () => {
      context.invitationSecretReplay.deleteWhere((invitation) => invitation.token === token);
    },
    execute: () => claimInvitation(context, input),
  });
}

export function createInvitationClaims(
  context: InvitationClaimContext,
): Pick<SsoCutoverAccountAdminPort, "acceptInvitation" | "claimInvitationForPrincipal"> {
  return {
    acceptInvitation: (input) => acceptInvitation(context, input),
    claimInvitationForPrincipal: (input) => claimInvitationForPrincipal(context, input),
  };
}
