import { ACCOUNT_ROLES } from "@capacitylens/shared/account/types";
import { can } from "@capacitylens/shared/domain/access";
import type { Role } from "@capacitylens/shared/domain/access";
import type { TeamMember as Member } from "@/account/teamAccessClient";
import type { TeamInvitation } from "@/account/teamAccessClient";
import { resolveRoleLabel } from "@/lib/accessCopy";

// Exclude Owner from ordinary role choices because ownership changes only through transfer. Resolve role labels at render so they follow the active locale.
const ASSIGNABLE_ROLES: readonly Role[] = ACCOUNT_ROLES.filter((role) => role !== "owner");
const ROLE_PRIORITY: Readonly<Record<Role, number>> = { owner: 0, admin: 1, editor: 2, viewer: 3 };
const compareText = (left: string | null | undefined, right: string | null | undefined) =>
  (left ?? "").localeCompare(right ?? "", undefined, { sensitivity: "base" });

function compareMembers(left: Member, right: Member): number {
  return (
    ROLE_PRIORITY[left.role] - ROLE_PRIORITY[right.role] ||
    compareText(left.name?.trim(), right.name?.trim()) ||
    compareText(left.userId, right.userId)
  );
}

/** Orders invitations consistently for the member directory. */
export function sortInvitationsForPresentation(invitations: readonly TeamInvitation[]): TeamInvitation[] {
  return [...invitations].sort(
    (left, right) =>
      ROLE_PRIORITY[left.role] - ROLE_PRIORITY[right.role] ||
      compareText(left.preauthEmail, right.preauthEmail) ||
      compareText(left.createdAt, right.createdAt) ||
      compareText(left.id, right.id),
  );
}

/** Derives role and invitation display state from the current member list. */
export function buildMemberDirectoryPresentation(members: Member[] | null) {
  const myRole = members?.find((member) => member.isSelf)?.role;
  const mayManageInvites = myRole !== undefined && can(myRole, "manageInvites");
  const mayManageSignInTracking = myRole !== undefined && can(myRole, "manageMemberSignInTracking");
  // Active and inactive members use the same role-first presentation order, independent of server join-date ordering. Inactive rows remain available through a disclosure.
  const grouped = { active: [] as Member[], inactive: [] as Member[] };
  for (const member of members ?? [])
    grouped[member.status === "active" && !member.accessDisabled ? "active" : "inactive"].push(member);
  const activeMembers = members ? grouped.active.sort(compareMembers) : null;
  const inactiveMembers = grouped.inactive.sort(compareMembers);

  const roleOptions = ASSIGNABLE_ROLES.map((value) => ({ value, label: resolveRoleLabel(value) }));

  return { activeMembers, inactiveMembers, myRole, mayManageInvites, mayManageSignInTracking, roleOptions };
}
