import type { IdentityAdminAction, Role } from './types'

export type AccountAdminAction =
  | 'list-members'
  | 'manage-members'
  | 'manage-invitations'
  | 'transfer-ownership'
  | 'erase-workspace'

const ROLE_RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
}

const MIN_ADMIN_TIER = {
  'list-members': 'admin',
  'manage-members': 'admin',
  'manage-invitations': 'admin',
  'transfer-ownership': 'owner',
  'erase-workspace': 'owner',
} as const satisfies Record<AccountAdminAction, Role>

export function isAtLeast(role: Role, minimum: Role): boolean {
  const actualRank = ROLE_RANK[role]
  const requiredRank = ROLE_RANK[minimum]
  return actualRank !== undefined && requiredRank !== undefined && actualRank >= requiredRank
}

export function canAdministerAccount(role: Role, action: AccountAdminAction): boolean {
  const minimum = MIN_ADMIN_TIER[action]
  return minimum !== undefined && isAtLeast(role, minimum)
}

export function canManageMemberRole(actorRole: Role, targetRole: Role, nextRole: Role): boolean {
  if (!canAdministerAccount(actorRole, 'manage-members')) return false
  return targetRole !== 'owner' && nextRole !== 'owner'
}

export function canRemoveMember(actorRole: Role, targetRole: Role): boolean {
  return canAdministerAccount(actorRole, 'manage-members') && targetRole !== 'owner'
}

export function canAdministerIdentity(actorRole: Role, targetRole: Role): boolean {
  if (!canAdministerAccount(actorRole, 'manage-members')) return false
  return targetRole !== 'owner' || actorRole === 'owner'
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
  if (targetRolesByWorkspace.size === 0) return false
  if (isSelf) return true
  for (const [workspaceId, targetRole] of targetRolesByWorkspace) {
    const actorRole = actorRolesByWorkspace.get(workspaceId)
    if (actorRole === undefined || !canAdministerIdentity(actorRole, targetRole)) return false
  }
  return true
}

export function canPerformIdentityAdminAction(
  action: IdentityAdminAction,
  actorRolesByWorkspace: ReadonlyMap<string, Role>,
  targetRolesByWorkspace: ReadonlyMap<string, Role>,
  isSelf: boolean,
): boolean {
  // Both supported operations alter identity-global security state and therefore intentionally use
  // the same all-workspaces standing rule. Keep the action check so an unknown future operation is
  // denied until its policy is explicitly classified.
  if (action !== 'issue-password-reset' && action !== 'revoke-sessions') return false
  return canAdministerIdentityAcrossWorkspaces(
    actorRolesByWorkspace,
    targetRolesByWorkspace,
    isSelf,
  )
}
