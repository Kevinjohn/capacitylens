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
import { readSecurityRevision } from "../state";
import type { AdminPortContext } from "./contracts";
import { ACCOUNT_POLICY_VERSION, SsoCutoverAccountAdminPort } from "./contracts";
import { createAccountFailure } from "./failures";
import { buildAuthorityRevision } from "./mappers";

export function assertWorkspaceExists(db: Db, workspaceId: string): { id: string; name: string } {
  const row = getRow(db, "accounts", workspaceId);
  if (!row) throw createAccountFailure("NOT_FOUND", "The workspace does not exist.");
  return { id: String(row.id), name: String(row.name) };
}

export function assertActorRole(db: Db, actor: ActorContext, workspaceId: string): Role {
  const role = getActiveMemberRole(db, workspaceId, actor.principalId);
  if (!role) throw createAccountFailure("NOT_MEMBER", "The actor is not a member of this workspace.");
  return role;
}

interface AssertAccountAuthorityInput {
  db: Db;
  actor: ActorContext;
  workspaceId: string;
  action: Parameters<typeof canAdministerAccount>[1];
  trustedLocal?: boolean | undefined;
}

export function assertAccountAuthority({
  db,
  actor,
  workspaceId,
  action,
  trustedLocal = false,
}: AssertAccountAuthorityInput): Role {
  assertWorkspaceExists(db, workspaceId);
  if (trustedLocal) return "owner";
  const role = assertActorRole(db, actor, workspaceId);
  if (!canAdministerAccount(role, action)) throw createAccountFailure("FORBIDDEN", "Forbidden.");
  return role;
}

interface AssertAdministrativeAssuranceInput {
  actor: ActorContext;
  requireMfa: boolean;
  trustedLocal: boolean;
  commandId?: string | undefined;
}

export function assertAdministrativeAssurance({
  actor,
  requireMfa,
  trustedLocal,
  commandId,
}: AssertAdministrativeAssuranceInput): void {
  if (trustedLocal) return;
  if (!actor.fresh) {
    throw createAccountFailure(
      "SESSION_NOT_FRESH",
      "A fresh sign-in is required for this account operation.",
      commandId,
    );
  }
  if (requireMfa && !actor.mfaSatisfied) {
    throw createAccountFailure(
      "MFA_REQUIRED",
      "Multi-factor authentication is required for this account operation.",
      commandId,
    );
  }
}

interface AssertInvitationAuthorityInput {
  db: Db;
  actor: ActorContext;
  requireMfa: boolean;
  trustedLocal: boolean;
  workspaceId: string;
  commandId: string;
}

/** createInvitation's replay guard and its execute path both open with this same authority check.
 *  assertAccountAuthority already asserts the workspace exists as its own first statement, so
 *  neither closure needs a trailing assertWorkspaceExists of its own. */
export function assertInvitationAuthority({
  db,
  actor,
  requireMfa,
  trustedLocal,
  workspaceId,
  commandId,
}: AssertInvitationAuthorityInput): void {
  assertAdministrativeAssurance({ actor, requireMfa, trustedLocal, commandId });
  assertAccountAuthority({ db, actor, workspaceId, action: "manage-invitations", trustedLocal });
}

export function readExistingWorkspaceIds(db: Db): ReadonlySet<string> {
  return new Set((db.prepare(`SELECT id FROM accounts`).all() as Array<{ id: string }>).map(({ id }) => id));
}

export function readActorRolesByWorkspaceId(
  db: Db,
  principalId: string,
  workspaceIds: ReadonlySet<string> = readExistingWorkspaceIds(db),
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
export function readTargetRolesByWorkspaceId(
  db: Db,
  principalId: string,
  workspaceIds: ReadonlySet<string>,
): Map<string, Role> {
  return new Map(
    listMembershipsForUser(db, principalId)
      .filter((row) => workspaceIds.has(row.accountId))
      .map((row) => [row.accountId, row.role]),
  );
}

interface BuildAuthorityDecisionsByActionInput {
  db: Db;
  actorPrincipalId: string;
  targetPrincipalId: string;
  actions: readonly IdentityAdminAction[];
  actorRoles: ReadonlyMap<string, Role>;
  targetRoles: ReadonlyMap<string, Role>;
  actorRevision: number;
}

export function buildAuthorityDecisionsByAction({
  db,
  actorPrincipalId,
  targetPrincipalId,
  actions,
  actorRoles,
  targetRoles,
  actorRevision,
}: BuildAuthorityDecisionsByActionInput): ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision> {
  const decisions = new Map<IdentityAdminAction, IdentityAdminAuthorityDecision>();
  if (targetRoles.size === 0) {
    for (const action of actions) decisions.set(action, { allowed: false, reason: "target-not-member" });
    return decisions;
  }
  if (actorRoles.size === 0) {
    for (const action of actions) decisions.set(action, { allowed: false, reason: "no-standing" });
    return decisions;
  }
  const revision = buildAuthorityRevision(actorRevision, readSecurityRevision(db, targetPrincipalId));
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

interface EvaluateAuthoritiesForTargetsInput {
  db: Db;
  actorPrincipalId: string;
  targetPrincipalIds: readonly string[];
  actions: readonly IdentityAdminAction[];
}

export function evaluateAuthoritiesForTargets({
  db,
  actorPrincipalId,
  targetPrincipalIds,
  actions,
}: EvaluateAuthoritiesForTargetsInput): ReadonlyMap<
  string,
  ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>
> {
  if (targetPrincipalIds.length === 0) return new Map();
  const workspaceIds = readExistingWorkspaceIds(db);
  const actorRoles = readActorRolesByWorkspaceId(db, actorPrincipalId, workspaceIds);
  const actorRevision = readSecurityRevision(db, actorPrincipalId);
  const results = new Map<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>();
  for (const targetPrincipalId of new Set(targetPrincipalIds)) {
    const targetRoles = readTargetRolesByWorkspaceId(db, targetPrincipalId, workspaceIds);
    results.set(
      targetPrincipalId,
      buildAuthorityDecisionsByAction({
        db,
        actorPrincipalId,
        targetPrincipalId,
        actions,
        actorRoles,
        targetRoles,
        actorRevision,
      }),
    );
  }
  return results;
}

interface EvaluateAuthoritiesInput {
  db: Db;
  actor: ActorContext;
  targetPrincipalId: string;
  actions: readonly IdentityAdminAction[];
}

export function evaluateAuthorities({
  db,
  actor,
  targetPrincipalId,
  actions,
}: EvaluateAuthoritiesInput): ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision> {
  const authorities = evaluateAuthoritiesForTargets({
    db,
    actorPrincipalId: actor.principalId,
    targetPrincipalIds: [targetPrincipalId],
    actions,
  }).get(targetPrincipalId);
  if (!authorities) throw createAccountFailure("FORBIDDEN", "Forbidden.");
  return authorities;
}

interface EvaluateAuthorityInput {
  db: Db;
  actor: ActorContext;
  targetPrincipalId: string;
  action: IdentityAdminAction;
}

export function evaluateAuthority({
  db,
  actor,
  targetPrincipalId,
  action,
}: EvaluateAuthorityInput): IdentityAdminAuthorityDecision {
  const authority = evaluateAuthorities({ db, actor, targetPrincipalId, actions: [action] }).get(action);
  if (!authority) throw createAccountFailure("FORBIDDEN", "Forbidden.");
  return authority;
}

interface AssertIdentityRepairAuthorityInput {
  db: Db;
  trustedLocal: boolean;
  requireMfa: boolean;
  actor: ActorContext;
  workspaceId: string;
  targetPrincipalId: string;
  action: IdentityAdminAction;
  expectedRevision: string;
}

function assertIdentityRepairAuthority({
  db,
  trustedLocal,
  requireMfa,
  actor,
  workspaceId,
  targetPrincipalId,
  action,
  expectedRevision,
}: AssertIdentityRepairAuthorityInput): void {
  assertAdministrativeAssurance({ actor, requireMfa, trustedLocal });
  assertAccountAuthority({ db, actor, workspaceId, action: "manage-members", trustedLocal });
  // Status-agnostic: this asks "is there a membership here to repair?", not "may this login act?".
  // An active-only probe would 404 the compromised-account case that identity repair exists for —
  // an admin disables the account FIRST and then kills its sessions / rotates its password, and
  // an active-only read here reports the person they just disabled as a non-member. The
  // authority question is answered below by evaluateAuthority, which still ranks roles.
  if (!getMembershipRow(db, workspaceId, targetPrincipalId)) {
    throw createAccountFailure("NOT_FOUND", "Not a member of this workspace.");
  }
  const current = evaluateAuthority({ db, actor, targetPrincipalId, action });
  if (!current.allowed) {
    throw createAccountFailure(
      current.reason === "target-not-member" ? "NOT_FOUND" : "FORBIDDEN",
      "Identity repair authority is no longer available.",
    );
  }
  if (current.revision !== expectedRevision) {
    throw createAccountFailure("CONFLICT", "Identity repair authority changed. Refresh and try again.");
  }
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
      assertAdministrativeAssurance({ actor, requireMfa, trustedLocal });
      return evaluateAuthority({ db, actor, targetPrincipalId, action });
    },
    async evaluateIdentityAdminAuthorities({
      actor,
      targetPrincipalId,
      actions,
    }): Promise<ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>> {
      assertAdministrativeAssurance({ actor, requireMfa, trustedLocal });
      return evaluateAuthorities({ db, actor, targetPrincipalId, actions });
    },
    async evaluateIdentityAdminAuthoritiesForTargets({
      actor,
      targetPrincipalIds,
      actions,
    }): Promise<ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>> {
      assertAdministrativeAssurance({ actor, requireMfa, trustedLocal });
      return evaluateAuthoritiesForTargets({ db, actorPrincipalId: actor.principalId, targetPrincipalIds, actions });
    },
    projectIdentityAdminAuthoritiesForTargets({ principalId, targetPrincipalIds, actions }) {
      return evaluateAuthoritiesForTargets({ db, actorPrincipalId: principalId, targetPrincipalIds, actions });
    },
    async confirmIdentityAdminAuthority({ actor, targetPrincipalId, action, expectedRevision }) {
      assertAdministrativeAssurance({ actor, requireMfa, trustedLocal });
      const current = evaluateAuthority({ db, actor, targetPrincipalId, action });
      return current.allowed && current.revision === expectedRevision;
    },
    assertIdentityRepairAuthorityInTx(input) {
      assertIdentityRepairAuthority({ db, trustedLocal, requireMfa, ...input });
    },
  };
}
