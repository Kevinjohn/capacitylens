import { ACCOUNT_ROLES } from "@capacitylens/shared/account/types";
import { can, type Role } from "@capacitylens/shared/domain/access";
import type { TeamMember as Member } from "../../account/teamAccessClient";
import { resolveRoleLabel } from "../../lib/accessCopy";

// The roles a member can be given here, in the shared vocabulary's own order. Owner is deliberately
// absent: ownership can change only through the explicit atomic transfer. Values only — no labels at
// module scope, because resolving `m.key()` here would freeze the wording to the load-time locale
// (P1.5.2); the labels come from `resolveRoleLabel` at render time instead.
const ASSIGNABLE_ROLES: readonly Role[] = ACCOUNT_ROLES.filter((role) => role !== "owner");

export function buildMemberDirectoryPresentation(members: Member[] | null) {
  const myRole = members?.find((member) => member.isSelf)?.role;
  const mayManageInvites = myRole !== undefined && can(myRole, "manageInvites");
  const mayManageSignInTracking = myRole !== undefined && can(myRole, "manageMemberSignInTracking");
  // The directory arrives in one list and splits in two for display (#175). The main table is the
  // team — no "active" heading, because those rows are simply the members. Disabled and archived
  // rows move into the collapsed group below; they keep their badge there, so the two states stay
  // distinguishable without a table each. The server's order (join date, then name) is preserved by
  // filtering rather than re-sorting.
  const grouped = { active: [] as Member[], inactive: [] as Member[] };
  for (const member of members ?? []) grouped[member.status === "active" ? "active" : "inactive"].push(member);
  const activeMembers = members ? grouped.active : null;
  const inactiveMembers = grouped.inactive;
  // Labels are resolved HERE, at render, not at module scope: a locale change must be reflected
  // without reloading the module (P1.5.2). Both the invite form and the pencil's editor offer the
  // same list, so it is built once.
  const roleOptions = ASSIGNABLE_ROLES.map((value) => ({ value, label: resolveRoleLabel(value) }));

  return { activeMembers, inactiveMembers, myRole, mayManageInvites, mayManageSignInTracking, roleOptions };
}
