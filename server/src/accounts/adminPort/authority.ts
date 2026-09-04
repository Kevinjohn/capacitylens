import { canAdministerAccount, canPerformIdentityAdminAction } from "@capacitylens/shared/account/policy";
import type {
  ActorContext,
  IdentityAdminAction,
  IdentityAdminAuthorityDecision,
  Role,
} from "@capacitylens/shared/account/types";
import { getActiveMemberRole, getMembershipRow, listMembershipsForUser } from "../../controlTables";
import type { Db } from "../../db";
import { getRow } from "../../db";
import { getSecurityRevision } from "../state";
import type { AdminPortContext } from "./contracts";
import { ACCOUNT_POLICY_VERSION, SsoCutoverAccountAdminPort } from "./contracts";
import { failure } from "./failures";
import { authorityRevision } from "./mappers";

export function assertWorkspaceExists(db: Db, workspaceId: string): { id: string; name: string } {
  const row = getRow(db, "accounts", workspaceId);
  if (!row) throw failure("NOT_FOUND", "The workspace does not exist.");
  return { id: String(row.id), name: String(row.name) };
}

export function actorRole(db: Db, actor: ActorContext, workspaceId: string): Role {
  const role = getActiveMemberRole(db, workspaceId, actor.principalId);
  if (!role) throw failure("NOT_MEMBER", "The actor is not a member of this workspace.");
  return role;
}

export function assertAccountAuthority(
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

export function assertAdministrativeAssurance(
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

/** createInvitation's replay guard and its execute path both open with this same authority check.
 *  assertAccountAuthority already asserts the workspace exists as its own first statement, so
 *  neither closure needs a trailing assertWorkspaceExists of its own. */
export function assertInvitationAuthority(
  db: Db,
  actor: ActorContext,
  requireMfa: boolean,
  trustedLocal: boolean,
  workspaceId: string,
  commandId: string,
): void {
  assertAdministrativeAssurance(actor, requireMfa, trustedLocal, commandId);
  assertAccountAuthority(db, actor, workspaceId, "manage-invitations", trustedLocal);
}

export function existingWorkspaceIds(db: Db): ReadonlySet<string> {
  return new Set((db.prepare(`SELECT id FROM accounts`).all() as Array<{ id: string }>).map(({ id }) => id));
}

export function roleMap(
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

/**
 * The same map for a TARGET of identity administration, counting memberships of every lifecycle
 * status. Deliberately NOT `roleMap`, and the asymmetry is the point in both directions:
 *
 * - An actor's authority must come only from ACTIVE memberships — a disabled admin administers
 *   nobody — so actors keep using `roleMap`.
 * - A target's non-active memberships must still COUNT. Dropping them made an empty map, which
 *   `authorityDecisions` reads as `target-not-member` and denies: disabling a member was therefore
 *   the act that destroyed the administrator's ability to revoke that member's live sessions or
 *   reset their password — exactly backwards for the compromised-account case that motivates
 *   disabling someone in the first place.
 *
 * Widening here cannot weaken the standing rule. `canAdministerIdentityAcrossWorkspaces` demands
 * the actor out-rank the target in EVERY workspace the target appears in, so adding workspaces to
 * the target's map can only hold the actor to a stricter test, never a laxer one.
 */
export function targetRoleMap(db: Db, principalId: string, workspaceIds: ReadonlySet<string>): Map<string, Role> {
  return new Map(
    listMembershipsForUser(db, principalId)
      .filter((row) => workspaceIds.has(row.accountId))
      .map((row) => [row.accountId, row.role]),
  );
}

export function authorityDecisions(
  db: Db,
  actorPrincipalId: string,
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
      actorPrincipalId === targetPrincipalId,
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

export function evaluateAuthoritiesForTargets(
  db: Db,
  actorPrincipalId: string,
  targetPrincipalIds: readonly string[],
  actions: readonly IdentityAdminAction[],
): ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>> {
  if (targetPrincipalIds.length === 0) return new Map();
  const workspaceIds = existingWorkspaceIds(db);
  const actorRoles = roleMap(db, actorPrincipalId, workspaceIds);
  const actorRevision = getSecurityRevision(db, actorPrincipalId);
  const results = new Map<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>();
  for (const targetPrincipalId of new Set(targetPrincipalIds)) {
    const targetRoles = targetRoleMap(db, targetPrincipalId, workspaceIds);
    results.set(
      targetPrincipalId,
      authorityDecisions(db, actorPrincipalId, targetPrincipalId, actions, actorRoles, targetRoles, actorRevision),
    );
  }
  return results;
}

export function evaluateAuthorities(
  db: Db,
  actor: ActorContext,
  targetPrincipalId: string,
  actions: readonly IdentityAdminAction[],
): ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision> {
  return evaluateAuthoritiesForTargets(db, actor.principalId, [targetPrincipalId], actions).get(targetPrincipalId)!;
}

export function evaluateAuthority(
  db: Db,
  actor: ActorContext,
  targetPrincipalId: string,
  action: IdentityAdminAction,
): IdentityAdminAuthorityDecision {
  return evaluateAuthorities(db, actor, targetPrincipalId, [action]).get(action)!;
}
export function createAuthority(
  context: Pick<AdminPortContext, "db" | "trustedLocal" | "requireMfa">,
): Pick<
  SsoCutoverAccountAdminPort,
  | "evaluateIdentityAdminAuthority"
  | "evaluateIdentityAdminAuthorities"
  | "evaluateIdentityAdminAuthoritiesForTargets"
  | "projectIdentityAdminAuthoritiesForTargets"
  | "confirmIdentityAdminAuthority"
  | "assertIdentityRepairAuthorityInTx"
> {
  const { db, trustedLocal, requireMfa } = context;

  return {
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
      return evaluateAuthoritiesForTargets(db, actor.principalId, targetPrincipalIds, actions);
    },
    projectIdentityAdminAuthoritiesForTargets({ principalId, targetPrincipalIds, actions }) {
      return evaluateAuthoritiesForTargets(db, principalId, targetPrincipalIds, actions);
    },
    async confirmIdentityAdminAuthority({ actor, targetPrincipalId, action, expectedRevision }) {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      const current = evaluateAuthority(db, actor, targetPrincipalId, action);
      return current.allowed && current.revision === expectedRevision;
    },
    assertIdentityRepairAuthorityInTx({ actor, workspaceId, targetPrincipalId, action, expectedRevision }) {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      assertAccountAuthority(db, actor, workspaceId, "manage-members", trustedLocal);
      // Status-agnostic: this asks "is there a membership here to repair?", not "may this login act?".
      // An active-only probe would 404 the compromised-account case that identity repair exists for —
      // an admin disables the account FIRST and then kills its sessions / rotates its password, and
      // an active-only read here reports the person they just disabled as a non-member. The
      // authority question is answered below by evaluateAuthority, which still ranks roles.
      if (!getMembershipRow(db, workspaceId, targetPrincipalId)) {
        throw failure("NOT_FOUND", "Not a member of this workspace.");
      }
      const current = evaluateAuthority(db, actor, targetPrincipalId, action);
      if (!current.allowed) {
        throw failure(
          current.reason === "target-not-member" ? "NOT_FOUND" : "FORBIDDEN",
          "Identity repair authority is no longer available.",
        );
      }
      if (current.revision !== expectedRevision) {
        throw failure("CONFLICT", "Identity repair authority changed. Refresh and try again.");
      }
    },
  };
}
