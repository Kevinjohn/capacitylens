/**
 * SmallSass's deliberately small account role vocabulary. Products can define narrower
 * feature-level predicates, but the account hierarchy and administrative capabilities stay
 * identical across the family.
 */
export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

export type Action =
  | 'read'
  | 'write'
  | 'manageMembers'
  | 'manageInvites'
  | 'purge'
  | 'deleteAccount'
  | 'transferOwnership'

const ROLE_RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
}

const MIN_TIER = {
  read: 'viewer',
  write: 'editor',
  manageMembers: 'admin',
  manageInvites: 'admin',
  purge: 'admin',
  deleteAccount: 'owner',
  transferOwnership: 'owner',
} as const satisfies Record<Action, Role>

/** Fail-closed permission check used by both UI affordances and server authorization. */
export function can(role: Role, action: Action): boolean {
  const have = ROLE_RANK[role]
  const minimum = MIN_TIER[action]
  const need = ROLE_RANK[minimum]
  if (have === undefined || need === undefined) return false
  return have >= need
}

/** Compare two roles using the same hierarchy as the permission matrix. */
export function isAtLeast(role: Role, minimum: Role): boolean {
  const have = ROLE_RANK[role]
  const need = ROLE_RANK[minimum]
  if (have === undefined || need === undefined) return false
  return have >= need
}

/**
 * Pure member-management guard. Last-owner protection still requires a database count and belongs
 * in the server transaction.
 */
export function canManageMemberRole(
  actorRole: Role,
  targetRole: Role,
  nextRole: Role,
): boolean {
  if (!can(actorRole, 'manageMembers')) return false
  if (nextRole === 'owner' && actorRole !== 'owner') return false
  if (targetRole === 'owner' && actorRole !== 'owner') return false
  return true
}

/** Admins can remove members, but only owners can remove another owner. */
export function canRemoveMember(actorRole: Role, targetRole: Role): boolean {
  if (!can(actorRole, 'manageMembers')) return false
  if (targetRole === 'owner' && actorRole !== 'owner') return false
  return true
}

/**
 * A password-reset link is an account-takeover capability, so it follows the same owner boundary
 * as removal.
 */
export function canResetMemberPassword(actorRole: Role, targetRole: Role): boolean {
  if (!can(actorRole, 'manageMembers')) return false
  if (targetRole === 'owner' && actorRole !== 'owner') return false
  return true
}

/**
 * Better Auth credentials are identity-global. An actor may reset someone else only when they have
 * sufficient authority in every account the target can enter. Self-reset is exempt because it
 * cannot confer access the actor does not already have.
 */
export function canResetMemberAcrossAccounts(
  actorRolesByAccount: ReadonlyMap<string, Role>,
  targetRolesByAccount: ReadonlyMap<string, Role>,
  isSelf: boolean,
): boolean {
  if (targetRolesByAccount.size === 0) return false
  if (isSelf) return true

  for (const [accountId, targetRole] of targetRolesByAccount) {
    const actorRole = actorRolesByAccount.get(accountId)
    if (actorRole === undefined) return false
    if (!canResetMemberPassword(actorRole, targetRole)) return false
  }
  return true
}
