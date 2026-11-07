import type { Role } from '@capacitylens/shared/domain/access';
import type { CompanyAccess } from '@capacitylens/shared/account/permissions';
import type { TeamMember as Member } from '@/account/teamAccessClient';
import type { TeamInvitation } from '@/account/teamAccessClient';
import { resolveRoleLabel } from '@/lib/accessCopy';

// Role choices come from the server-derived assignable roles; Owner is never assignable because
// ownership changes only through transfer. Resolve role labels at render so they follow the active locale.
const ROLE_PRIORITY: Readonly<Record<Role, number>> = { owner: 0, admin: 1, editor: 2, viewer: 3 };
const compareText = (left: string | null | undefined, right: string | null | undefined) =>
  (left ?? '').localeCompare(right ?? '', undefined, { sensitivity: 'base' });

function compareMembers(left: Member, right: Member): number {
  return (
    ROLE_PRIORITY[left.role] - ROLE_PRIORITY[right.role] ||
    compareText(left.name?.trim(), right.name?.trim()) ||
    compareText(left.userId, right.userId)
  );
}

/** Orders invitations consistently for the member directory. */
export function sortInvitationsForPresentation(
  invitations: readonly TeamInvitation[],
): TeamInvitation[] {
  return [...invitations].sort(
    (left, right) =>
      ROLE_PRIORITY[left.role] - ROLE_PRIORITY[right.role] ||
      compareText(left.preauthEmail, right.preauthEmail) ||
      compareText(left.createdAt, right.createdAt) ||
      compareText(left.id, right.id),
  );
}

/** Derives role and invitation display state from the member list and the caller's authority. */
export function buildMemberDirectoryPresentation(
  members: Member[] | null,
  access: CompanyAccess | null,
) {
  const myRole = members?.find((member) => member.isSelf)?.role;
  const mayManageInvites = access?.permissions.includes('invitations:manage') ?? false;
  const mayManageSignInTracking = access?.permissions.includes('members:signInTracking') ?? false;
  // Active and inactive members use the same role-first presentation order, independent of server join-date ordering. Inactive rows remain available through a disclosure.
  const grouped = { active: [] as Member[], inactive: [] as Member[] };
  for (const member of members ?? []) {
    grouped[member.status === 'active' && !member.accessDisabled ? 'active' : 'inactive'].push(
      member,
    );
  }
  const activeMembers = members ? grouped.active.sort(compareMembers) : null;
  const inactiveMembers = grouped.inactive.sort(compareMembers);

  const roleOptions = (access?.assignableRoles ?? []).map((value: Role) => ({
    value,
    label: resolveRoleLabel(value),
  }));

  return {
    activeMembers,
    inactiveMembers,
    myRole,
    mayManageInvites,
    mayManageSignInTracking,
    roleOptions,
  };
}
