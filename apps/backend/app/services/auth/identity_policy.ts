import type { Role } from '@capacitylens/shared/account/types';
import { isAccountRole } from '@capacitylens/shared/account/types';
import access from '#config/access_control';

/** Identity operations need member management standing; only an Owner may act on an Owner. */
export function canAdministerIdentity(actorRole: Role, targetRole: Role): boolean {
  if (!access.can(actorRole, 'members:manage') || !isAccountRole(targetRole)) return false;
  return targetRole !== 'owner' || actorRole === 'owner';
}

/** The actor needs standing in every workspace the target can enter; self needs one membership. */
export function canAdministerIdentityAcrossWorkspaces(
  actorRoles: ReadonlyMap<string, Role>,
  targetRoles: ReadonlyMap<string, Role>,
  isSelf: boolean
): boolean {
  if (targetRoles.size === 0) return false;
  if (isSelf) return true;
  for (const [workspaceId, targetRole] of targetRoles) {
    const actorRole = actorRoles.get(workspaceId);
    if (actorRole === undefined || !canAdministerIdentity(actorRole, targetRole)) return false;
  }
  return true;
}
