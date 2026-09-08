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
import { createOperationReceipt } from "../accountFlowRuntime";
import {
  assertAccountAuthority,
  assertAdministrativeAssurance,
  assertInvitationAuthority,
  assertWorkspaceExists,
} from "./authority";
import type { AdminPortContext } from "./contracts";
import { MAX_INVITATION_TTL_MS, SsoCutoverAccountAdminPort } from "./contracts";
import {
  assertInvitationRole,
  assertRedeemableInvitationRole,
  createAccountFailure,
  createReplayCapacityFailure,
} from "./failures";

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

type InvitationsContext = Pick<
  AdminPortContext,
  "db" | "trustedLocal" | "requireMfa" | "invitationSecretReplay" | "runMutation"
>;
type InvitationMethod<Name extends keyof SsoCutoverAccountAdminPort> = SsoCutoverAccountAdminPort[Name];
type InvitationInput<Name extends keyof SsoCutoverAccountAdminPort> = Parameters<InvitationMethod<Name>>[0];

async function listInvitations(
  context: InvitationsContext,
  { actor, workspaceId }: InvitationInput<"listInvitations">,
) {
  const { db, requireMfa, trustedLocal } = context;
  assertAdministrativeAssurance({ actor, requireMfa, trustedLocal });
  assertAccountAuthority({ db, actor, workspaceId, action: "manage-invitations", trustedLocal });
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
}

async function previewInvitation(context: InvitationsContext, { token }: InvitationInput<"previewInvitation">) {
  const invite = getInvite(context.db, token);
  if (!invite) throw createAccountFailure("NOT_FOUND", "Invite not found.");
  if (invite.usedAt !== null) throw createAccountFailure("INVITATION_USED", "This invite has already been used.");
  if (inviteIsExpired(invite.expiresAt)) throw createAccountFailure("INVITATION_EXPIRED", "This invite has expired.");
  assertRedeemableInvitationRole(invite.role);
  const workspace = assertWorkspaceExists(context.db, invite.accountId);
  return { workspaceName: workspace.name, role: invite.role, expiresAt: invite.expiresAt };
}

async function preparePasswordInvitationClaim(
  context: InvitationsContext,
  { token, normalizedEmail }: InvitationInput<"preparePasswordInvitationClaim">,
) {
  const invite = getInvite(context.db, token);
  if (!invite) throw createAccountFailure("NOT_FOUND", "Invite not found.");
  if (invite.usedAt !== null) throw createAccountFailure("INVITATION_USED", "This invite has already been used.");
  if (inviteIsExpired(invite.expiresAt)) throw createAccountFailure("INVITATION_EXPIRED", "This invite has expired.");
  assertRedeemableInvitationRole(invite.role);
  assertWorkspaceExists(context.db, invite.accountId);
  if (invite.preauthEmail !== null && normalizeEmail(normalizedEmail) !== invite.preauthEmail) {
    throw createAccountFailure("INVITATION_EMAIL_MISMATCH", "This invite is reserved for a different email address.");
  }
  return { emailVerifiedByInvitation: invite.preauthEmail !== null, workspaceId: invite.accountId };
}

function executeInvitationCreation(
  context: InvitationsContext,
  { workspaceId, role, preauthorizedEmail, expiresAt, command }: InvitationInput<"createInvitation">,
): CreatedInvitation {
  const { db, invitationSecretReplay } = context;
  assertInvitationRole(role, command.commandId);
  const nowMs = Date.now();
  const effectiveExpiresAt = expiresAt ?? new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();
  const expiry = parseISOTimestamp(effectiveExpiresAt);
  if (expiry === null || expiry <= nowMs) {
    throw createAccountFailure("VALIDATION_FAILED", "expiresAt must be in the future.", command.commandId);
  }
  if (expiry > nowMs + MAX_INVITATION_TTL_MS) {
    throw createAccountFailure("VALIDATION_FAILED", "Invitations may be valid for at most 30 days.", command.commandId);
  }
  const normalized = preauthorizedEmail === null ? null : normalizeAccountEmail(preauthorizedEmail);
  if (normalized !== null && !isAccountEmail(normalized)) {
    throw createAccountFailure(
      "VALIDATION_FAILED",
      "The preauthorized invitation email address is invalid.",
      command.commandId,
    );
  }
  pruneInvites(db, nowMs, workspaceId);
  const reservation = invitationSecretReplay.reserve(command.commandId, nowMs);
  if (reservation.kind === "rejected") {
    throw createReplayCapacityFailure(command.commandId, reservation.retryAfterMs);
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
}

async function createInvitation(
  context: InvitationsContext,
  input: InvitationInput<"createInvitation">,
): Promise<CreatedInvitation> {
  const { actor, workspaceId, role, preauthorizedEmail, expiresAt, command } = input;
  const { db, trustedLocal, requireMfa, invitationSecretReplay, runMutation } = context;
  assertInvitationRole(role, command.commandId);
  return runMutation<() => CreatedInvitation>({
    operation: "create-invitation",
    actorPrincipalId: actor.principalId,
    workspaceId,
    command,
    payload: { workspaceId, role, preauthorizedEmail, expiresAt },
    lockKeys: [actor.principalId, `workspace:${workspaceId}`],
    audit: { action: "invitation.created", changedFields: ["role", "preauthorizedEmail", "expiresAt"] },
    persistResult: ({
      id,
      workspaceId: createdWorkspaceId,
      role: createdRole,
      expiresAt: createdExpiresAt,
      usedAt,
      createdAt,
    }) => ({ id, workspaceId: createdWorkspaceId, role: createdRole, expiresAt: createdExpiresAt, usedAt, createdAt }),
    replayResult: (_stored, commandId) => {
      const replay = invitationSecretReplay.get(commandId);
      if (replay) return replay;
      throw createAccountFailure(
        "CONFLICT",
        "The invitation command already completed; its write-once token is no longer available.",
        commandId,
      );
    },
    replayGuard: () => {
      // Re-evaluate current authority before re-disclosing the cached write-once bearer token.
      assertInvitationAuthority({ db, actor, requireMfa, trustedLocal, workspaceId, commandId: command.commandId });
    },
    afterCommit: (invitation) => invitationSecretReplay.storeReserved(command.commandId, invitation),
    afterRollback: () => invitationSecretReplay.releaseReservation(command.commandId),
    execute: () => {
      assertInvitationAuthority({ db, actor, requireMfa, trustedLocal, workspaceId, commandId: command.commandId });
      return executeInvitationCreation(context, input);
    },
  });
}

async function revokeInvitation(context: InvitationsContext, input: InvitationInput<"revokeInvitation">) {
  const { actor, workspaceId, invitationId, command } = input;
  const { db, trustedLocal, requireMfa, invitationSecretReplay, runMutation } = context;
  return runMutation({
    operation: "revoke-invitation",
    actorPrincipalId: actor.principalId,
    workspaceId,
    command,
    payload: { workspaceId, invitationId },
    lockKeys: [actor.principalId, `workspace:${workspaceId}`],
    audit: { action: "invitation.revoked", changedFields: ["invitation"] },
    afterCommit: () => invitationSecretReplay.deleteWhere((invitation) => invitation.id === invitationId),
    execute: () => {
      assertAdministrativeAssurance({ actor, requireMfa, trustedLocal, commandId: command.commandId });
      assertAccountAuthority({ db, actor, workspaceId, action: "manage-invitations", trustedLocal });
      const changed = listInvitesForAccount(db, workspaceId).some((invite) => invite.id === invitationId);
      revokeInvite(db, workspaceId, invitationId);
      return createOperationReceipt({ commandId: command.commandId, changed });
    },
  });
}

export function createInvitations(
  context: InvitationsContext,
): Pick<
  SsoCutoverAccountAdminPort,
  "listInvitations" | "previewInvitation" | "preparePasswordInvitationClaim" | "createInvitation" | "revokeInvitation"
> {
  return {
    listInvitations: (input) => listInvitations(context, input),
    previewInvitation: (input) => previewInvitation(context, input),
    preparePasswordInvitationClaim: (input) => preparePasswordInvitationClaim(context, input),
    createInvitation: (input) => createInvitation(context, input),
    revokeInvitation: (input) => revokeInvitation(context, input),
  };
}
