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
import { assertRedeemableInvitationRole, failure } from "./failures";
import { membership } from "./mappers";

export function createHashForToken(token: string): string {
  return createHash("sha256").update("account-command-invite\0").update(token).digest("hex");
}
export function createInvitationClaims(
  context: Pick<AdminPortContext, "applicationId" | "db" | "trustedLocal" | "invitationSecretReplay" | "runMutation">,
): Pick<SsoCutoverAccountAdminPort, "acceptInvitation" | "claimInvitationForPrincipal"> {
  const { applicationId, db, trustedLocal, invitationSecretReplay, runMutation } = context;
  function claimInvitation(input: {
    token: string;
    principalId: string;
    principalEmail: string;
    emailVerified: boolean;
    passwordMode: boolean;
    command: CommandIdentity;
  }): Membership {
    const live = getInvite(db, input.token);
    if (!live) throw failure("NOT_FOUND", "Invite not found.", input.command.commandId);
    if (live.usedAt !== null) {
      throw failure("INVITATION_USED", "This invite has already been used.", input.command.commandId);
    }
    if (inviteIsExpired(live.expiresAt)) {
      throw failure("INVITATION_EXPIRED", "This invite has expired.", input.command.commandId);
    }
    assertRedeemableInvitationRole(live.role, input.command.commandId);
    assertWorkspaceExists(db, live.accountId);
    if (
      !trustedLocal &&
      !preauthInviteAllows(
        live.preauthEmail,
        {
          email: input.principalEmail,
          emailVerified: input.emailVerified,
        },
        input.passwordMode,
      )
    ) {
      throw failure(
        "INVITATION_EMAIL_MISMATCH",
        "This invite is reserved for a different identity.",
        input.command.commandId,
      );
    }
    const now = new Date().toISOString();
    // Status-AGNOSTIC on purpose. An active-only probe reports a disabled or archived member as a
    // NON-member, and the branch below would then upsert them back to `status: "active"` at the
    // invite's role — silently reversing an administrator's decision, with no member.status_changed
    // audit record, for anyone who still holds (or is handed) a link-only invite. A non-active
    // membership is restored by an administrator through changeMemberStatus, never by its holder.
    const existing = getMembershipRow(db, live.accountId, input.principalId);
    if (existing && existing.status !== "active") {
      throw failure(
        "FORBIDDEN",
        // Covers disabled AND archived, so it names neither: the person redeeming the link has no
        // business knowing which, and an inaccurate "disabled" on an archived row would be worse.
        "This membership is no longer active. An Owner or Admin must restore it before you can rejoin.",
        input.command.commandId,
      );
    }
    const effectiveRole = existing?.role ?? live.role;
    if (!existing) {
      upsertMember(db, {
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
    confirmTrackedMemberSignIn(db, input.principalId);
    try {
      markInviteUsed(db, input.token, now);
    } catch (error) {
      if (error instanceof InviteAlreadyUsedError) {
        throw failure("INVITATION_USED", "This invite has already been used.", input.command.commandId);
      }
      throw error;
    }
    pruneInvites(db, Date.parse(now), live.accountId);
    const row = listMembershipsForUser(db, input.principalId).find(
      (candidate) => candidate.accountId === live.accountId,
    );
    if (!row) throw new Error("Invitation claim committed without a membership row.");
    return membership(db, row);
  }
  return {
    async acceptInvitation({ actor, token, principalEmail, emailVerified, command }) {
      const passwordMode = actor.assurance === "password" || actor.assurance === "mfa";
      const operation = `accept-invitation:actor:${actor.principalId}`;
      const payload = { tokenHash: createHashForToken(token), passwordMode };
      const resumed = resumeExistingCommand<Membership>(
        db,
        { applicationId, operation, actorPrincipalId: actor.principalId },
        command,
        payload,
      );
      if (resumed) return markAccountCommandReplay(resumed.result);
      const invite = getInvite(db, token);
      if (!invite) throw failure("NOT_FOUND", "Invite not found.", command.commandId);
      const accepted = await runMutation({
        operation: "accept-invitation",
        actorPrincipalId: actor.principalId,
        targetPrincipalId: actor.principalId,
        workspaceId: invite.accountId,
        command,
        payload,
        lockKeys: [actor.principalId, `workspace:${invite.accountId}`],
        audit: { action: "invitation.accepted", changedFields: ["membership"] },
        afterCommit: () => {
          invitationSecretReplay.deleteWhere((invitation) => invitation.token === token);
        },
        execute: () =>
          claimInvitation({
            token,
            principalId: actor.principalId,
            principalEmail,
            emailVerified,
            passwordMode,
            command,
          }),
      });
      return accepted;
    },
    async claimInvitationForPrincipal({ token, principalId, principalEmail, emailVerified, passwordMode, command }) {
      const payload = {
        tokenHash: createHashForToken(token),
        principalId,
        principalEmail,
        emailVerified,
        passwordMode,
      };
      const resumed = resumeExistingCommand<Membership>(
        db,
        { applicationId, operation: "claim-invitation", actorPrincipalId: null },
        command,
        payload,
      );
      if (resumed) return markAccountCommandReplay(resumed.result);
      const invite = getInvite(db, token);
      if (!invite) throw failure("NOT_FOUND", "Invite not found.", command.commandId);
      const claimed = await runMutation({
        operation: "claim-invitation",
        actorPrincipalId: null,
        targetPrincipalId: principalId,
        workspaceId: invite.accountId,
        command,
        payload,
        lockKeys: [principalId, `workspace:${invite.accountId}`],
        audit: { action: "invitation.accepted", changedFields: ["membership"] },
        afterCommit: () => {
          invitationSecretReplay.deleteWhere((invitation) => invitation.token === token);
        },
        execute: () =>
          claimInvitation({
            token,
            principalId,
            principalEmail,
            emailVerified,
            passwordMode,
            command,
          }),
      });
      return claimed;
    },
  };
}
