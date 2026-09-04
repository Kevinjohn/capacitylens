import type { CreatedInvitation } from "@capacitylens/shared/account/types";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { parseISOTimestamp } from "@capacitylens/shared/lib/integrity";
import { randomBytes } from "node:crypto";
import {
  createInvite,
  getInvite,
  inviteIsExpired,
  listInvitesForAccount,
  newInviteId,
  normalizeEmail,
  pruneInvites,
  revokeInvite,
} from "../../controlTables";
import type { Db } from "../../db";
import { receipt } from "../accountFlowRuntime";
import {
  assertAccountAuthority,
  assertAdministrativeAssurance,
  assertInvitationAuthority,
  assertWorkspaceExists,
} from "./authority";
import type { AdminPortContext } from "./contracts";
import { MAX_INVITATION_TTL_MS, SsoCutoverAccountAdminPort } from "./contracts";
import { assertInvitationRole, assertRedeemableInvitationRole, failure, replayCapacityFailure } from "./failures";

/** Narrow admission fact for the identity creation hook. It exposes only a boolean; invitation
 * rows, bearer hashes and preauthorized addresses remain account-adapter-owned. */
export function hasLivePreauthorizedInvitation(db: Db, normalizedEmail: string, now = Date.now()): boolean {
  const rows = db
    .prepare(
      `
    SELECT invitation.expiresAt
      FROM invites AS invitation
      JOIN accounts AS workspace ON workspace.id = invitation.accountId
     WHERE invitation.preauthEmail = ?
       AND invitation.usedAt IS NULL
  `,
    )
    .all(normalizedEmail) as Array<{ expiresAt: string }>;
  return rows.some((row) => !inviteIsExpired(row.expiresAt, now));
}
export function createInvitations(
  context: Pick<AdminPortContext, "db" | "trustedLocal" | "requireMfa" | "invitationSecretReplay" | "runMutation">,
): Pick<
  SsoCutoverAccountAdminPort,
  "listInvitations" | "previewInvitation" | "preparePasswordInvitationClaim" | "createInvitation" | "revokeInvitation"
> {
  const { db, trustedLocal, requireMfa, invitationSecretReplay, runMutation } = context;

  return {
    async listInvitations({ actor, workspaceId }) {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      assertAccountAuthority(db, actor, workspaceId, "manage-invitations", trustedLocal);
      return listInvitesForAccount(db, workspaceId).flatMap((invite) => {
        // Reads remain pure. Hide an expired unused bearer from the live management view without
        // deleting it outside the command ledger / mutation transaction.
        if (invite.usedAt === null && inviteIsExpired(invite.expiresAt)) return [];
        // Migration v10 deliberately retained already-used Owner invites as inert historical rows.
        // They cannot satisfy the InvitationSummary contract (which excludes Owner), and rejecting
        // one would hide every live invitation in the workspace, so omit only this legacy shape.
        if (invite.role === "owner") return [];
        return [
          {
            id: invite.id,
            workspaceId: invite.accountId,
            role: invite.role,
            preauthorizedEmail: invite.preauthEmail,
            expiresAt: invite.expiresAt,
            usedAt: invite.usedAt,
            createdAt: invite.createdAt,
          },
        ];
      });
    },
    async previewInvitation({ token }) {
      const invite = getInvite(db, token);
      if (!invite) throw failure("NOT_FOUND", "Invite not found.");
      if (invite.usedAt !== null) throw failure("INVITATION_USED", "This invite has already been used.");
      if (inviteIsExpired(invite.expiresAt)) throw failure("INVITATION_EXPIRED", "This invite has expired.");
      assertRedeemableInvitationRole(invite.role);
      const workspace = assertWorkspaceExists(db, invite.accountId);
      return {
        workspaceName: workspace.name,
        role: invite.role,
        expiresAt: invite.expiresAt,
      };
    },
    async preparePasswordInvitationClaim({ token, normalizedEmail }) {
      const invite = getInvite(db, token);
      if (!invite) throw failure("NOT_FOUND", "Invite not found.");
      if (invite.usedAt !== null) throw failure("INVITATION_USED", "This invite has already been used.");
      if (inviteIsExpired(invite.expiresAt)) throw failure("INVITATION_EXPIRED", "This invite has expired.");
      assertRedeemableInvitationRole(invite.role);
      assertWorkspaceExists(db, invite.accountId);
      if (invite.preauthEmail !== null && normalizeEmail(normalizedEmail) !== invite.preauthEmail) {
        throw failure("INVITATION_EMAIL_MISMATCH", "This invite is reserved for a different email address.");
      }
      return {
        emailVerifiedByInvitation: invite.preauthEmail !== null,
        workspaceId: invite.accountId,
      };
    },
    async createInvitation({
      actor,
      workspaceId,
      role,
      preauthorizedEmail,
      expiresAt,
      command,
    }): Promise<CreatedInvitation> {
      assertInvitationRole(role, command.commandId);
      const created = await runMutation<() => CreatedInvitation>({
        operation: "create-invitation",
        actorPrincipalId: actor.principalId,
        workspaceId,
        command,
        payload: { workspaceId, role, preauthorizedEmail, expiresAt },
        lockKeys: [actor.principalId, `workspace:${workspaceId}`],
        audit: {
          action: "invitation.created",
          changedFields: ["role", "preauthorizedEmail", "expiresAt"],
        },
        persistResult: ({
          id,
          workspaceId: createdWorkspaceId,
          role: createdRole,
          expiresAt: createdExpiresAt,
          usedAt,
          createdAt,
        }) => ({
          id,
          workspaceId: createdWorkspaceId,
          role: createdRole,
          expiresAt: createdExpiresAt,
          usedAt,
          createdAt,
        }),
        replayResult: (_stored, commandId) => {
          const replay = invitationSecretReplay.get(commandId);
          if (replay) return replay;
          throw failure(
            "CONFLICT",
            "The invitation command already completed; its write-once token is no longer available.",
            commandId,
          );
        },
        replayGuard: () => {
          // A command replay can re-disclose the write-once bearer token. Re-evaluate current
          // authority first so a removed/demoted actor cannot recover it from the process cache.
          assertInvitationAuthority(db, actor, requireMfa, trustedLocal, workspaceId, command.commandId);
        },
        afterCommit: (invitation) => {
          invitationSecretReplay.storeReserved(command.commandId, invitation);
        },
        afterRollback: () => {
          invitationSecretReplay.releaseReservation(command.commandId);
        },
        execute: () => {
          assertInvitationAuthority(db, actor, requireMfa, trustedLocal, workspaceId, command.commandId);
          const nowMs = Date.now();
          const effectiveExpiresAt = expiresAt ?? new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();
          const expiry = parseISOTimestamp(effectiveExpiresAt);
          if (expiry === null || expiry <= nowMs) {
            throw failure("VALIDATION_FAILED", "expiresAt must be in the future.", command.commandId);
          }
          if (expiry > nowMs + MAX_INVITATION_TTL_MS) {
            throw failure("VALIDATION_FAILED", "Invitations may be valid for at most 30 days.", command.commandId);
          }
          const normalized = preauthorizedEmail === null ? null : normalizeAccountEmail(preauthorizedEmail);
          if (normalized !== null && !isAccountEmail(normalized)) {
            throw failure(
              "VALIDATION_FAILED",
              "The preauthorized invitation email address is invalid.",
              command.commandId,
            );
          }
          pruneInvites(db, nowMs, workspaceId);
          const reservation = invitationSecretReplay.reserve(command.commandId, nowMs);
          if (!reservation.accepted) {
            throw replayCapacityFailure(command.commandId, reservation.retryAfterMs);
          }
          const token = randomBytes(32).toString("base64url");
          const now = new Date().toISOString();
          const id = newInviteId();
          const canonicalExpiresAt = new Date(expiry).toISOString();
          createInvite(db, {
            token,
            id,
            accountId: workspaceId,
            role,
            preauthEmail: normalized,
            expiresAt: canonicalExpiresAt,
            usedAt: null,
            createdAt: now,
          });
          return {
            token,
            id,
            workspaceId,
            role,
            preauthorizedEmail: normalized,
            expiresAt: canonicalExpiresAt,
            usedAt: null,
            createdAt: now,
          };
        },
      });
      return created;
    },
    async revokeInvitation({ actor, workspaceId, invitationId, command }) {
      const revoked = await runMutation({
        operation: "revoke-invitation",
        actorPrincipalId: actor.principalId,
        workspaceId,
        command,
        payload: { workspaceId, invitationId },
        lockKeys: [actor.principalId, `workspace:${workspaceId}`],
        audit: { action: "invitation.revoked", changedFields: ["invitation"] },
        afterCommit: () => {
          invitationSecretReplay.deleteWhere((invitation) => invitation.id === invitationId);
        },
        execute: () => {
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          assertAccountAuthority(db, actor, workspaceId, "manage-invitations", trustedLocal);
          const changed = listInvitesForAccount(db, workspaceId).some((invite) => invite.id === invitationId);
          revokeInvite(db, workspaceId, invitationId);
          return receipt(command.commandId, changed);
        },
      });
      return revoked;
    },
  };
}
