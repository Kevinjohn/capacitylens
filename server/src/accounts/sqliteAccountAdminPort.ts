import { createHash, randomBytes } from "node:crypto";
import { AccountContractError, retryAfterSeconds, type AccountErrorCode } from "@capacitylens/shared/account/errors";
import {
  canAdministerAccount,
  canManageMemberRole,
  canPerformIdentityAdminAction,
  canRemoveMember,
} from "@capacitylens/shared/account/policy";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import type { AccountAuditPort } from "@capacitylens/shared/account/ports";
import type { AccountAuditAction } from "@capacitylens/shared/account/audit";
import type {
  ActorContext,
  CommandIdentity,
  CreatedInvitation,
  IdentityAdminAction,
  IdentityAdminAuthorityDecision,
  InvitationRole,
  Membership,
  OperationReceipt,
  OwnershipTransfer,
  Role,
} from "@capacitylens/shared/account/types";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { parseISOTimestamp } from "@capacitylens/shared/lib/integrity";
import {
  createInvite,
  getActiveMemberRole,
  getInvite,
  inviteIsExpired,
  listInvitesForAccount,
  listMembersForAccount,
  listMembershipsForUser,
  markInviteUsed,
  newInviteId,
  normalizeEmail,
  preauthInviteAllows,
  removeAllInvitesForAccount,
  removeAllMembersForAccount,
  removeMember as removeMemberRow,
  revokeInvite,
  upsertMember,
  type AccountMember,
  InviteAlreadyUsedError,
} from "../controlTables";
import type { Db } from "../db";
import { getRow } from "../db";
import { tx, type SynchronousCallback } from "../txn";
import {
  beginCommand,
  completeCommand,
  markAccountCommandReplay,
  resumeExistingCommand,
  terminateCommand,
} from "./commands";
import { KeyedOperationLock } from "./operationLock";
import { getSecurityRevision } from "./state";
import { WriteOnceSecretReplay } from "./writeOnceSecretReplay";
import { accountAuditWriter, recordTerminalOutcome } from "./accountFlowRuntime";

export const ACCOUNT_POLICY_VERSION = "account-policy-v1";
export const MAX_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SECRET_REPLAYS = 256;

/** Narrow admission fact for the identity creation hook. It exposes only a boolean; invitation
 * rows, bearer hashes and preauthorized addresses remain account-adapter-owned. */
export function hasLivePreauthorizedInvitation(db: Db, normalizedEmail: string, now = Date.now()): boolean {
  const rows = db
    .prepare(
      `
    SELECT invitation.expiresAt
      FROM invites AS invitation
      JOIN accounts AS workspace ON workspace.id = invitation.accountId
     WHERE lower(trim(invitation.preauthEmail)) = ?
       AND invitation.usedAt IS NULL
  `,
    )
    .all(normalizedEmail) as Array<{ expiresAt: string }>;
  return rows.some((row) => !inviteIsExpired(row.expiresAt, now));
}

export interface LocalAccountAdminPort extends AccountAdminPort {
  roleForPrincipalInWorkspace(principalId: string, workspaceId: string): Role | null;
  workspacePrincipalIds(workspaceId: string): readonly string[];
  evaluateWorkspaceProvisioningAuthorityInTx(input: {
    actor: ActorContext;
    multiWorkspace: boolean;
    bootstrapAuthorized: boolean;
    /** Final transaction-wide count for a trusted-local batch replacement. */
    projectedWorkspaceCount?: number;
  }):
    | { allowed: true }
    | {
        allowed: false;
        reason: "single-workspace-cap" | "insufficient-authority";
      };
  provisionOwnerMembershipInTx(input: { workspaceId: string; principalId: string; joinedAt: string }): Membership;
  assertWorkspaceErasureAuthorityInTx(actor: ActorContext, workspaceId: string): void;
  /** Remove the erased workspace's control rows and return principals with no membership row in
   * any surviving workspace. All statuses count here so identity deprovisioning cannot leave a
   * surviving control row pointing at an erased principal. */
  eraseWorkspaceAdministrationInTx(workspaceId: string): readonly string[];
}

function failure(code: AccountErrorCode, message: string, commandId?: string): AccountContractError {
  return new AccountContractError({
    code,
    message,
    retryable: false,
    commandId,
  });
}

function replayCapacityFailure(commandId: string, retryAfterMs: number): AccountContractError {
  return new AccountContractError({
    code: "RATE_LIMITED",
    message: "One-time link issuance is temporarily busy. Retry after the indicated interval.",
    retryable: true,
    retryAfterSeconds: retryAfterSeconds(Math.ceil(retryAfterMs / 1_000)),
    commandId,
  });
}

function membership(db: Db, row: AccountMember): Membership {
  return {
    workspaceId: row.accountId,
    principalId: row.userId,
    role: row.role,
    status: row.status,
    joinedAt: row.createdAt,
    membershipRevision: String(getSecurityRevision(db, row.userId)),
    policyVersion: ACCOUNT_POLICY_VERSION,
  };
}

function receipt(commandId: string, changed?: boolean): OperationReceipt {
  return {
    commandId,
    completedAt: new Date().toISOString(),
    ...(changed === undefined ? {} : { changed }),
  };
}

function assertInvitationRole(role: Role, commandId?: string): asserts role is InvitationRole {
  if (role === "owner") {
    throw failure(
      "OWNER_TRANSFER_REQUIRED",
      "Owner access cannot be assigned directly. Transfer ownership to an existing member instead.",
      commandId,
    );
  }
}

function assertRedeemableInvitationRole(role: Role, commandId?: string): asserts role is InvitationRole {
  if (role === "owner") {
    throw failure(
      "INVITATION_EXPIRED",
      "This Owner invite is no longer valid. Ownership must be transferred.",
      commandId,
    );
  }
}

function assertWorkspaceExists(db: Db, workspaceId: string): { id: string; name: string } {
  const row = getRow(db, "accounts", workspaceId);
  if (!row) throw failure("NOT_FOUND", "The workspace does not exist.");
  return { id: String(row.id), name: String(row.name) };
}

function actorRole(db: Db, actor: ActorContext, workspaceId: string): Role {
  const role = getActiveMemberRole(db, workspaceId, actor.principalId);
  if (!role) throw failure("NOT_MEMBER", "The actor is not a member of this workspace.");
  return role;
}

function assertAccountAuthority(
  db: Db,
  actor: ActorContext,
  workspaceId: string,
  action: Parameters<typeof canAdministerAccount>[1],
  trustedLocal = false,
): Role {
  assertWorkspaceExists(db, workspaceId);
  if (trustedLocal) return "owner";
  const role = actorRole(db, actor, workspaceId);
  if (!canAdministerAccount(role, action)) throw failure("FORBIDDEN", "Forbidden.");
  return role;
}

function assertAdministrativeAssurance(
  actor: ActorContext,
  requireMfa: boolean,
  trustedLocal: boolean,
  commandId?: string,
): void {
  if (trustedLocal) return;
  if (!actor.fresh) {
    throw failure("SESSION_NOT_FRESH", "A fresh sign-in is required for this account operation.", commandId);
  }
  if (requireMfa && !actor.mfaSatisfied) {
    throw failure("MFA_REQUIRED", "Multi-factor authentication is required for this account operation.", commandId);
  }
}

function existingWorkspaceIds(db: Db): ReadonlySet<string> {
  return new Set((db.prepare(`SELECT id FROM accounts`).all() as Array<{ id: string }>).map(({ id }) => id));
}

function roleMap(
  db: Db,
  principalId: string,
  workspaceIds: ReadonlySet<string> = existingWorkspaceIds(db),
): Map<string, Role> {
  return new Map(
    listMembershipsForUser(db, principalId)
      // account_members intentionally predates a foreign key to accounts. Never let a dangling
      // legacy/control-table row confer identity-global authority after its workspace is gone.
      .filter((row) => row.status === "active" && workspaceIds.has(row.accountId))
      .map((row) => [row.accountId, row.role]),
  );
}

function authorityRevision(actorRevision: number, targetRevision: number): string {
  return `actor:${actorRevision};target:${targetRevision}`;
}

function authorityDecisions(
  db: Db,
  actor: ActorContext,
  targetPrincipalId: string,
  actions: readonly IdentityAdminAction[],
  actorRoles: ReadonlyMap<string, Role>,
  targetRoles: ReadonlyMap<string, Role>,
  actorRevision: number,
): ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision> {
  const decisions = new Map<IdentityAdminAction, IdentityAdminAuthorityDecision>();
  if (targetRoles.size === 0) {
    for (const action of actions) decisions.set(action, { allowed: false, reason: "target-not-member" });
    return decisions;
  }
  if (actorRoles.size === 0) {
    for (const action of actions) decisions.set(action, { allowed: false, reason: "no-standing" });
    return decisions;
  }
  const revision = authorityRevision(actorRevision, getSecurityRevision(db, targetPrincipalId));
  for (const action of actions) {
    const allowed = canPerformIdentityAdminAction(
      action,
      actorRoles,
      targetRoles,
      actor.principalId === targetPrincipalId,
    );
    decisions.set(
      action,
      allowed
        ? { allowed: true, revision, policyVersion: ACCOUNT_POLICY_VERSION }
        : { allowed: false, reason: "insufficient-authority" },
    );
  }
  return decisions;
}

function evaluateAuthoritiesForTargets(
  db: Db,
  actor: ActorContext,
  targetPrincipalIds: readonly string[],
  actions: readonly IdentityAdminAction[],
): ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>> {
  if (targetPrincipalIds.length === 0) return new Map();
  const workspaceIds = existingWorkspaceIds(db);
  const actorRoles = roleMap(db, actor.principalId, workspaceIds);
  const actorRevision = getSecurityRevision(db, actor.principalId);
  const results = new Map<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>();
  for (const targetPrincipalId of new Set(targetPrincipalIds)) {
    const targetRoles = roleMap(db, targetPrincipalId, workspaceIds);
    results.set(
      targetPrincipalId,
      authorityDecisions(db, actor, targetPrincipalId, actions, actorRoles, targetRoles, actorRevision),
    );
  }
  return results;
}

function evaluateAuthorities(
  db: Db,
  actor: ActorContext,
  targetPrincipalId: string,
  actions: readonly IdentityAdminAction[],
): ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision> {
  return evaluateAuthoritiesForTargets(db, actor, [targetPrincipalId], actions).get(targetPrincipalId)!;
}

function evaluateAuthority(
  db: Db,
  actor: ActorContext,
  targetPrincipalId: string,
  action: IdentityAdminAction,
): IdentityAdminAuthorityDecision {
  return evaluateAuthorities(db, actor, targetPrincipalId, [action]).get(action)!;
}

export function sqliteAccountAdminPort(input: {
  applicationId: string;
  db: Db;
  lock: KeyedOperationLock;
  trustedLocal?: boolean;
  requireMfa?: boolean;
  audit?: AccountAuditPort;
  /** Test seam; production uses the bounded default. */
  writeOnceReplayCapacity?: number;
}): LocalAccountAdminPort {
  const { applicationId, db, lock, trustedLocal = false, requireMfa = false } = input;
  const audit = accountAuditWriter(applicationId, input.audit);
  const invitationSecretReplay = new WriteOnceSecretReplay<CreatedInvitation>(
    input.writeOnceReplayCapacity ?? MAX_SECRET_REPLAYS,
  );

  async function runMutation<Execute extends () => unknown>(options: {
    operation: string;
    actorPrincipalId: string | null;
    targetPrincipalId?: string | null;
    workspaceId?: string | null;
    command: CommandIdentity;
    payload: unknown;
    lockKeys: readonly string[];
    execute: SynchronousCallback<Execute>;
    persistResult?: (result: ReturnType<Execute>) => unknown;
    replayResult?: (stored: unknown, commandId: string) => ReturnType<Execute>;
    replayGuard?: () => void;
    /** In-memory secret/cache maintenance that must happen after commit but before lock release. */
    afterCommit?: (result: ReturnType<Execute>) => void;
    /** Release any in-memory reservation after the database transaction rolls back. */
    afterRollback?: () => void;
    audit?: {
      action: AccountAuditAction;
      changedFields: readonly string[];
    };
  }): Promise<ReturnType<Execute>> {
    return lock.withKeys(options.lockKeys, async () => {
      const scope = {
        applicationId,
        operation: options.actorPrincipalId
          ? `${options.operation}:actor:${options.actorPrincipalId}`
          : options.operation,
        actorPrincipalId: options.actorPrincipalId,
        targetPrincipalId: options.targetPrincipalId ?? null,
        workspaceId: options.workspaceId ?? null,
      };
      const begun = beginCommand<unknown>(db, scope, options.command, options.payload);
      if (begun.kind === "replay") {
        options.replayGuard?.();
        return markAccountCommandReplay(
          options.replayResult
            ? options.replayResult(begun.result, begun.record.commandId)
            : (begun.result as ReturnType<Execute>),
        );
      }
      let result: ReturnType<Execute>;
      try {
        // Execute has already crossed this coordinator's SynchronousCallback boundary. Preserve
        // that proof for the transaction wrapper that also writes the command completion row.
        const transaction = (() => {
          const result = options.execute() as ReturnType<Execute>;
          completeCommand(db, scope, options.command, options.persistResult ? options.persistResult(result) : result);
          if (options.audit) {
            audit({
              action: options.audit.action,
              outcome: "success",
              workspaceId: options.workspaceId,
              actorPrincipalId: options.actorPrincipalId,
              targetPrincipalId: options.targetPrincipalId,
              command: options.command,
              changedFields: options.audit.changedFields,
            });
          }
          return result;
        }) as SynchronousCallback<() => ReturnType<Execute>>;
        result = tx(db, transaction, "immediate");
      } catch (error) {
        options.afterRollback?.();
        // The domain write rolled back with the transaction, so this is a known compensated outcome.
        // Record it outside the rolled-back transaction without hiding the original error.
        recordTerminalOutcome(
          error,
          () => {
            tx(
              db,
              () => {
                terminateCommand(
                  db,
                  scope,
                  options.command,
                  "compensated",
                  error instanceof AccountContractError ? error.failure.code : "CONFLICT",
                );
                if (options.audit) {
                  const code = error instanceof AccountContractError ? error.failure.code : null;
                  const denied =
                    code === "FORBIDDEN" ||
                    code === "NOT_MEMBER" ||
                    code === "SESSION_NOT_FRESH" ||
                    code === "MFA_REQUIRED";
                  audit({
                    action: options.audit.action,
                    outcome: denied ? "denied" : "failed",
                    workspaceId: options.workspaceId,
                    actorPrincipalId: options.actorPrincipalId,
                    targetPrincipalId: options.targetPrincipalId,
                    command: options.command,
                  });
                }
              },
              "immediate",
            );
          },
          "Account command failed and its compensation outcome could not be recorded.",
        );
        throw error;
      }
      // The command and domain mutation are now committed, while all mutation keys are still held.
      // This closes the replay window in which another request could otherwise recover a consumed
      // or revoked write-once token before the process-local cache was updated.
      options.afterCommit?.(result);
      return result;
    });
  }

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
    const existing = getActiveMemberRole(db, live.accountId, input.principalId);
    const effectiveRole = existing ?? live.role;
    if (!existing) {
      upsertMember(db, {
        accountId: live.accountId,
        userId: input.principalId,
        role: effectiveRole,
        status: "active",
        createdAt: now,
      });
    }
    try {
      markInviteUsed(db, input.token, now);
    } catch (error) {
      if (error instanceof InviteAlreadyUsedError) {
        throw failure("INVITATION_USED", "This invite has already been used.", input.command.commandId);
      }
      throw error;
    }
    const row = listMembershipsForUser(db, input.principalId).find(
      (candidate) => candidate.accountId === live.accountId,
    );
    if (!row) throw new Error("Invitation claim committed without a membership row.");
    return membership(db, row);
  }

  return {
    roleForPrincipalInWorkspace(principalId, workspaceId) {
      if (!getRow(db, "accounts", workspaceId)) return null;
      return getActiveMemberRole(db, workspaceId, principalId);
    },

    workspacePrincipalIds(workspaceId) {
      return listMembersForAccount(db, workspaceId).map((row) => row.userId);
    },

    evaluateWorkspaceProvisioningAuthorityInTx({
      actor,
      multiWorkspace,
      bootstrapAuthorized,
      projectedWorkspaceCount,
    }) {
      const count = Number(
        (db.prepare(`SELECT COUNT(*) AS count FROM accounts`).get() as { count?: number | bigint } | undefined)
          ?.count ?? 0,
      );
      const effectiveCount = projectedWorkspaceCount ?? count + 1;
      if (effectiveCount > 1 && !multiWorkspace) {
        return { allowed: false, reason: "single-workspace-cap" };
      }
      if (count === 0 || trustedLocal || bootstrapAuthorized) return { allowed: true };
      const allowed = [...roleMap(db, actor.principalId).values()].some((role) =>
        canAdministerAccount(role, "manage-members"),
      );
      if (!allowed) return { allowed: false, reason: "insufficient-authority" };
      // This arm converts existing account administration into a new Owner grant. Apply the same
      // step-up boundary as membership and invitation administration after proving the role, so a
      // lower-privilege caller still receives the ordinary authority refusal.
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      return { allowed: true };
    },

    provisionOwnerMembershipInTx({ workspaceId, principalId, joinedAt }) {
      upsertMember(db, {
        accountId: workspaceId,
        userId: principalId,
        role: "owner",
        status: "active",
        createdAt: joinedAt,
      });
      const row = listMembershipsForUser(db, principalId).find((candidate) => candidate.accountId === workspaceId);
      if (!row) throw new Error("Workspace provisioning did not create its Owner membership.");
      return membership(db, row);
    },

    assertWorkspaceErasureAuthorityInTx(actor, workspaceId): void {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      const role = assertAccountAuthority(db, actor, workspaceId, "erase-workspace", trustedLocal);
      if (role !== "owner") throw failure("FORBIDDEN", "Only the workspace owner may erase it.");
    },

    eraseWorkspaceAdministrationInTx(workspaceId) {
      const principalIds = [...new Set(listMembersForAccount(db, workspaceId).map((row) => row.userId))];
      removeAllMembersForAccount(db, workspaceId);
      removeAllInvitesForAccount(db, workspaceId);
      return principalIds.filter(
        (principalId) =>
          !listMembershipsForUser(db, principalId).some((row) => getRow(db, "accounts", row.accountId) !== undefined),
      );
    },

    async listWorkspacesForPrincipal({ principalId }) {
      return listMembershipsForUser(db, principalId)
        .filter((row) => row.status === "active")
        .flatMap((row) => {
          const workspace = getRow(db, "accounts", row.accountId);
          return workspace
            ? [
                {
                  workspaceId: row.accountId,
                  workspaceName: String(workspace.name),
                  role: row.role,
                  membershipRevision: String(getSecurityRevision(db, principalId)),
                  policyVersion: ACCOUNT_POLICY_VERSION,
                },
              ]
            : [];
        })
        .sort(
          (left, right) =>
            left.workspaceName.localeCompare(right.workspaceName) || left.workspaceId.localeCompare(right.workspaceId),
        );
    },

    async getMembership({ principalId, workspaceId }) {
      if (!getRow(db, "accounts", workspaceId)) return null;
      const row = listMembershipsForUser(db, principalId).find(
        (candidate) => candidate.accountId === workspaceId && candidate.status === "active",
      );
      return row ? membership(db, row) : null;
    },

    async listMemberships({ actor, workspaceId }) {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      assertAccountAuthority(db, actor, workspaceId, "list-members", trustedLocal);
      return listMembersForAccount(db, workspaceId)
        .filter((row) => row.status === "active")
        .map((row) => membership(db, row));
    },

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
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          assertAccountAuthority(db, actor, workspaceId, "manage-invitations", trustedLocal);
          assertWorkspaceExists(db, workspaceId);
        },
        afterCommit: (invitation) => {
          invitationSecretReplay.storeReserved(command.commandId, invitation);
        },
        afterRollback: () => {
          invitationSecretReplay.releaseReservation(command.commandId);
        },
        execute: () => {
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          assertAccountAuthority(db, actor, workspaceId, "manage-invitations", trustedLocal);
          assertWorkspaceExists(db, workspaceId);
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

    async changeMemberRole({ actor, workspaceId, targetPrincipalId, nextRole, command }) {
      assertInvitationRole(nextRole, command.commandId);
      return runMutation({
        operation: "change-member-role",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        workspaceId,
        command,
        payload: { workspaceId, targetPrincipalId, nextRole },
        lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
        audit: { action: "member.role_changed", changedFields: ["role"] },
        execute: () => {
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          const acting = assertAccountAuthority(db, actor, workspaceId, "manage-members", trustedLocal);
          const target = getActiveMemberRole(db, workspaceId, targetPrincipalId);
          if (!target) throw failure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          if (!canManageMemberRole(acting, target, nextRole))
            throw failure("FORBIDDEN", "Forbidden.", command.commandId);
          upsertMember(db, {
            accountId: workspaceId,
            userId: targetPrincipalId,
            role: nextRole,
            status: "active",
            createdAt: new Date().toISOString(),
          });
          const row = listMembershipsForUser(db, targetPrincipalId).find(
            (candidate) => candidate.accountId === workspaceId,
          )!;
          return membership(db, row);
        },
      });
    },

    async removeMember({ actor, workspaceId, targetPrincipalId, command }) {
      return runMutation({
        operation: "remove-member",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        workspaceId,
        command,
        payload: { workspaceId, targetPrincipalId },
        lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
        audit: { action: "member.removed", changedFields: ["membership"] },
        execute: () => {
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          const acting = assertAccountAuthority(db, actor, workspaceId, "manage-members", trustedLocal);
          const target = getActiveMemberRole(db, workspaceId, targetPrincipalId);
          if (!target) throw failure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          if (!canRemoveMember(acting, target)) throw failure("FORBIDDEN", "Forbidden.", command.commandId);
          removeMemberRow(db, workspaceId, targetPrincipalId);
          return receipt(command.commandId);
        },
      });
    },

    async transferOwnership({ actor, workspaceId, targetPrincipalId, command }): Promise<OwnershipTransfer> {
      return runMutation({
        operation: "transfer-ownership",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        workspaceId,
        command,
        payload: { workspaceId, targetPrincipalId },
        lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
        audit: {
          action: "ownership.transferred",
          changedFields: ["role", "owner"],
        },
        execute: () => {
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          assertAccountAuthority(db, actor, workspaceId, "transfer-ownership", trustedLocal);
          if (actor.principalId === targetPrincipalId) {
            throw failure("VALIDATION_FAILED", "The actor already owns this workspace.", command.commandId);
          }
          if (!getActiveMemberRole(db, workspaceId, targetPrincipalId)) {
            throw failure("NOT_FOUND", "The next owner must already be a member.", command.commandId);
          }
          const now = new Date().toISOString();
          upsertMember(db, {
            accountId: workspaceId,
            userId: actor.principalId,
            role: "admin",
            status: "active",
            createdAt: now,
          });
          upsertMember(db, {
            accountId: workspaceId,
            userId: targetPrincipalId,
            role: "owner",
            status: "active",
            createdAt: now,
          });
          const prior = listMembershipsForUser(db, actor.principalId).find((row) => row.accountId === workspaceId)!;
          const next = listMembershipsForUser(db, targetPrincipalId).find((row) => row.accountId === workspaceId)!;
          return {
            previousOwner: membership(db, prior),
            nextOwner: membership(db, next),
          };
        },
      });
    },

    async evaluateIdentityAdminAuthority({
      actor,
      targetPrincipalId,
      action,
    }): Promise<IdentityAdminAuthorityDecision> {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      return evaluateAuthority(db, actor, targetPrincipalId, action);
    },

    async evaluateIdentityAdminAuthorities({
      actor,
      targetPrincipalId,
      actions,
    }): Promise<ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>> {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      return evaluateAuthorities(db, actor, targetPrincipalId, actions);
    },

    async evaluateIdentityAdminAuthoritiesForTargets({
      actor,
      targetPrincipalIds,
      actions,
    }): Promise<ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>> {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      return evaluateAuthoritiesForTargets(db, actor, targetPrincipalIds, actions);
    },

    async confirmIdentityAdminAuthority({ actor, targetPrincipalId, action, expectedRevision }) {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      const current = evaluateAuthority(db, actor, targetPrincipalId, action);
      return current.allowed && current.revision === expectedRevision;
    },
  };
}

function createHashForToken(token: string): string {
  return createHash("sha256").update("account-command-invite\0").update(token).digest("hex");
}
