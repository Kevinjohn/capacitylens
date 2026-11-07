import { ACCOUNT_ROLES } from '@capacitylens/shared/account/types';
import type { Role } from '@capacitylens/shared/account/types';
import {
  accessPermissions,
  accessRoles,
  PERMISSION_KEYS,
} from '@capacitylens/shared/account/permissions';
import type {
  CompanyAccess,
  MemberActions,
  PermissionKey,
} from '@capacitylens/shared/account/permissions';
import { DEFAULT_ACCOUNT_ID } from './fixtures';

type PermissionTable = Record<string, Record<string, Role>>;

/** A resolved company authority for `role`, built from the shared permission thresholds. */
export function authorityFixture(
  role: Role,
  accountId: string = DEFAULT_ACCOUNT_ID,
): CompanyAccess {
  const rank = accessRoles.indexOf(role);
  const permissions = PERMISSION_KEYS.filter((key: PermissionKey) => {
    const [resource = '', action = ''] = key.split(':');
    const threshold = (accessPermissions as PermissionTable)[resource]?.[action];
    return threshold !== undefined && rank >= accessRoles.indexOf(threshold);
  });
  const assignableRoles = permissions.includes('members:manage')
    ? ACCOUNT_ROLES.filter((candidate) => candidate !== 'owner')
    : [];
  return { scopeId: accountId, role, permissions, assignableRoles };
}

/** The member fields that decide server-derived row actions. */
export interface MemberActionsFixtureTarget {
  role: Role;
  isSelf?: boolean;
  status?: string;
  accessDisabled?: boolean;
  membershipPresent?: boolean;
}

/** Row actions shaped like the server's derivation: managers act on non-Owner peers, never themselves. */
export function memberActionsFixture(
  actorRole: Role,
  target: MemberActionsFixtureTarget,
): MemberActions {
  const actor = authorityFixture(actorRole);
  const isSelf = target.isSelf === true;
  const present = target.membershipPresent !== false;
  const active = target.status === undefined || target.status === 'active';
  const restricted = target.accessDisabled === true;
  const mayManageTarget =
    actor.permissions.includes('members:manage') && target.role !== 'owner' && !isSelf;
  const manage = present && mayManageTarget;
  return {
    changeRole: manage && active && !restricted,
    changeStatus: manage,
    remove: manage,
    enableAccess: restricted && mayManageTarget,
    viewAs: !isSelf && present && active && !restricted && actor.permissions.includes('viewAs:use'),
  };
}

/** The resolved authority fixture for a role, or null when no membership role applies. */
export function authorityFor(role: Role | null, accountId?: string): CompanyAccess | null {
  return role === null ? null : authorityFixture(role, accountId);
}

/** The `setActiveAuthority` input for a resolved role, as PermissionProvider publishes it. */
export function resolvedAuthority(
  role: Role,
  accountId?: string,
): { role: Role; status: 'resolved'; access: CompanyAccess } {
  return { role, status: 'resolved', access: authorityFixture(role, accountId) };
}
