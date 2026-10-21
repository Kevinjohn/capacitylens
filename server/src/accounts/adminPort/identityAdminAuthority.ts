import { canPerformIdentityAdminAction } from "@capacitylens/shared/account/policy";
import type {
  ActorContext,
  IdentityAdminAction,
  IdentityAdminAuthorityDecision,
  Role,
} from "@capacitylens/shared/account/types";
import { getActiveMemberRole, getMembershipRow, listMembershipsForUser } from "../../controlTables";
import type { Db } from "../../db";
import { readSecurityRevision } from "../state";
import type { AdminPortContext, SsoCutoverAccountAdminPort } from "./contracts";
import { ACCOUNT_POLICY_VERSION } from "./contracts";
import { assertAccountAuthority, assertAdministrativeAssurance } from "./accountAuthority";
import { createAccountFailure } from "./failures";
import { buildAuthorityRevision } from "./mappers";

/** Reads workspace ids from SQLite so authority checks use persisted state. */
export function readExistingWorkspaceIds(db: Db): ReadonlySet<string> {
  return new Set((db.prepare(`SELECT id FROM accounts`).all() as Array<{ id: string }>).map(({ id }) => id));
}

/** Reads active roles so authority decisions reflect current workspace access. */
export function readActorRolesByWorkspaceId(
  db: Db,
  principalId: string,
  workspaceIds: ReadonlySet<string> = readExistingWorkspaceIds(db),
): Map<string, Role> {
  return new Map(
    listMembershipsForUser(db, principalId)
      // account_members intentionally predates a foreign key to accounts. Never let a dangling
      // legacy/control-table row confer identity-global authority after its workspace is gone.
      .filter(
        (row) =>
          row.status === "active" &&
          workspaceIds.has(row.accountId) &&
          getActiveMemberRole(db, row.accountId, principalId) !== null,
      )
      .map((row) => [row.accountId, row.role]),
  );
}

/**
 * Reads every target membership status for identity-global administration checks.
 * Actor authority uses active memberships only. Targets include disabled and archived memberships
 * so disabling access cannot prevent session revocation or password reset, For another principal, the actor must
 * outrank them in every workspace that principal occupies.
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

/** Builds per-action decisions from the actor and target roles. */
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

/** Evaluates each target against one actor authority snapshot for consistent decisions. */
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

/** Evaluates administrative authority against current role and session assurance. */
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

/** Evaluates one administrative action through the shared authority policy. */
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
  actor: ActorContext;
  workspaceId: string;
  targetPrincipalId: string;
  action: IdentityAdminAction;
  expectedRevision: string;
}

function assertIdentityRepairAuthority({
  db,
  trustedLocal,
  actor,
  workspaceId,
  targetPrincipalId,
  action,
  expectedRevision,
}: AssertIdentityRepairAuthorityInput): void {
  assertAdministrativeAssurance({ actor, trustedLocal });
  assertAccountAuthority({ db, actor, workspaceId, action: "manage-members", trustedLocal });
  // Status-agnostic: this asks "is there a membership here to repair?", not "may this login act?".
  // An active-only probe would 404 the compromised-account case that identity repair exists for,
  // an admin disables the account first and then kills its sessions / rotates its password, and
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

/** Binds authority checks to the request's database and trust mode. */
export function createIdentityAdminAuthority(
  context: Pick<AdminPortContext, "db" | "trustedLocal">,
): Pick<
  SsoCutoverAccountAdminPort,
  | "evaluateIdentityAdminAuthority"
  | "evaluateIdentityAdminAuthorities"
  | "evaluateIdentityAdminAuthoritiesForTargets"
  | "projectIdentityAdminAuthoritiesForTargets"
  | "confirmIdentityAdminAuthority"
  | "assertIdentityRepairAuthorityInTx"
> {
  const { db, trustedLocal } = context;

  return {
    async evaluateIdentityAdminAuthority({
      actor,
      targetPrincipalId,
      action,
    }): Promise<IdentityAdminAuthorityDecision> {
      assertAdministrativeAssurance({ actor, trustedLocal });
      return evaluateAuthority({ db, actor, targetPrincipalId, action });
    },
    async evaluateIdentityAdminAuthorities({
      actor,
      targetPrincipalId,
      actions,
    }): Promise<ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>> {
      assertAdministrativeAssurance({ actor, trustedLocal });
      return evaluateAuthorities({ db, actor, targetPrincipalId, actions });
    },
    async evaluateIdentityAdminAuthoritiesForTargets({
      actor,
      targetPrincipalIds,
      actions,
    }): Promise<ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>> {
      assertAdministrativeAssurance({ actor, trustedLocal });
      return evaluateAuthoritiesForTargets({ db, actorPrincipalId: actor.principalId, targetPrincipalIds, actions });
    },
    projectIdentityAdminAuthoritiesForTargets({ principalId, targetPrincipalIds, actions }) {
      return evaluateAuthoritiesForTargets({ db, actorPrincipalId: principalId, targetPrincipalIds, actions });
    },
    async confirmIdentityAdminAuthority({ actor, targetPrincipalId, action, expectedRevision }) {
      assertAdministrativeAssurance({ actor, trustedLocal });
      const current = evaluateAuthority({ db, actor, targetPrincipalId, action });
      return current.allowed && current.revision === expectedRevision;
    },
    assertIdentityRepairAuthorityInTx({ actor, workspaceId, targetPrincipalId, action, expectedRevision }) {
      assertIdentityRepairAuthority({
        db,
        trustedLocal,
        actor,
        workspaceId,
        targetPrincipalId,
        action,
        expectedRevision,
      });
    },
  };
}
