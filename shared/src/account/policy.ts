import { isAccountRole, type IdentityAdminAction, type Role } from "./types";

export type AccountAdminAction =
  | "list-members"
  | "manage-members"
  | "manage-invitations"
  | "manage-member-sign-in-tracking"
  | "transfer-ownership"
  | "erase-workspace";

const ROLE_RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

const MIN_ADMIN_TIER = {
  "list-members": "admin",
  "manage-members": "admin",
  "manage-invitations": "admin",
  "manage-member-sign-in-tracking": "owner",
  "transfer-ownership": "owner",
  "erase-workspace": "owner",
} as const satisfies Record<AccountAdminAction, Role>;

export function isAtLeast(role: Role, minimum: Role): boolean {
  const actualRank = ROLE_RANK[role];
  const requiredRank = ROLE_RANK[minimum];
  return actualRank !== undefined && requiredRank !== undefined && actualRank >= requiredRank;
}

export function canAdministerAccount(role: Role, action: AccountAdminAction): boolean {
  const minimum = MIN_ADMIN_TIER[action];
  return minimum !== undefined && isAtLeast(role, minimum);
}

export function canManageMemberRole(actorRole: Role, targetRole: Role, nextRole: Role): boolean {
  if (!canAdministerAccount(actorRole, "manage-members") || !isAccountRole(targetRole) || !isAccountRole(nextRole))
    return false;
  return targetRole !== "owner" && nextRole !== "owner";
}

export function canRemoveMember(actorRole: Role, targetRole: Role): boolean {
  return isAccountRole(targetRole) && canAdministerAccount(actorRole, "manage-members") && targetRole !== "owner";
}

/**
 * May `actor` move `target`'s membership between lifecycle states (disable / archive / restore)?
 *
 * Deliberately the SAME authority as removal, minus self-service: suspending a membership denies
 * account entry exactly as removal does, so it must not be reachable by anyone who could not also
 * remove the target. The Owner exclusion inside {@link canRemoveMember} is load-bearing beyond
 * policy taste — the physical single-active-Owner index and the boot assertion both key on
 * `role = 'owner' AND status = 'active'`, so disabling an Owner would leave a member-bearing
 * account ownerless and fail the next boot.
 *
 * Self-operation is refused rather than merely discouraged: an administrator who disabled their own
 * membership would immediately lose the authority needed to reverse it, and for a sole Admin that
 * is an unrecoverable lockout no in-app path could undo.
 */
export function canChangeMemberStatus(actorRole: Role, targetRole: Role, isSelf: boolean): boolean {
  if (isSelf) return false;
  return canRemoveMember(actorRole, targetRole);
}

export function canAdministerIdentity(actorRole: Role, targetRole: Role): boolean {
  if (!canAdministerAccount(actorRole, "manage-members") || !isAccountRole(targetRole)) return false;
  return targetRole !== "owner" || actorRole === "owner";
}

/**
 * Identity security operations affect every workspace the target can enter in this installation.
 * The actor therefore needs sufficient standing in every target workspace. Self-operation is safe
 * from cross-identity escalation but still requires the target to have at least one membership.
 */
export function canAdministerIdentityAcrossWorkspaces(
  actorRolesByWorkspace: ReadonlyMap<string, Role>,
  targetRolesByWorkspace: ReadonlyMap<string, Role>,
  isSelf: boolean,
): boolean {
  if (targetRolesByWorkspace.size === 0) return false;
  if (isSelf) return true;
  for (const [workspaceId, targetRole] of targetRolesByWorkspace) {
    const actorRole = actorRolesByWorkspace.get(workspaceId);
    if (actorRole === undefined || !canAdministerIdentity(actorRole, targetRole)) return false;
  }
  return true;
}

export function canPerformIdentityAdminAction(
  action: IdentityAdminAction,
  actorRolesByWorkspace: ReadonlyMap<string, Role>,
  targetRolesByWorkspace: ReadonlyMap<string, Role>,
  isSelf: boolean,
): boolean {
  // All supported operations alter identity-global security state and therefore intentionally use
  // the same all-workspaces standing rule. Keep the action check so an unknown future operation is
  // denied until its policy is explicitly classified.
  if (
    action !== "issue-password-reset" &&
    action !== "revoke-sessions" &&
    action !== "correct-email" &&
    action !== "remove-federated-link"
  )
    return false;
  return canAdministerIdentityAcrossWorkspaces(actorRolesByWorkspace, targetRolesByWorkspace, isSelf);
}
