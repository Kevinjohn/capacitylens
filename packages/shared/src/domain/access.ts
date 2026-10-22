// CapacityLens product permissions. Canonical account roles and administrative policy live in the
// provider-neutral account contract; this module adds product-data actions and field visibility.
// Both the browser and server import these pure rules so affordances and enforcement cannot drift.
import type { Role } from "../account/types.js";
import type { CapacityOverviewAccess } from "../types/entities.js";
import {
  canAdministerAccount,
  canAdministerIdentityAcrossWorkspaces,
  canChangeMemberStatus as canChangeCanonicalMemberStatus,
  canEditAnyMemberRole as canEditAnyCanonicalMemberRole,
  canManageMemberRole as canManageCanonicalMemberRole,
  canRemoveMember as canRemoveCanonicalMember,
  isAtLeast as isAtLeastCanonicalRole,
} from "../account/policy.js";
import type { AccountAdminAction } from "../account/policy.js";
export type { Role } from "../account/types.js";

/**
 * A guarded capability the access matrix gates. These are coarse policy *actions* (not 1:1 with
 * HTTP routes); `requirePermission` maps each protected route onto one of these before
 * calling {@link can}. The required tier is documented per member:
 *
 * - `'read'`: view an account's scheduling data. Any member (owner | admin | editor | viewer).
 * - `'write'`: create / edit / delete scheduling records and ordinary account planning/display
 *                          configuration. Editor and up (owner | admin | editor); not viewer.
 * - `'manageInternalClient'`: adopt a legacy built-in Internal-client id and reparent its projects.
 *                              Admin tier (owner | admin).
 * - `'manageMembers'`: add / remove members and change their roles. Admin tier (owner | admin).
 * - `'manageInvites'`: create / revoke invites (link + email-preauth). Admin tier (owner | admin).
 * - `'masquerade'`: view the account through another active member's read projection. Admin tier.
 * - `'manageMemberSignInTracking'`: opt into coarse sign-in confirmation. Owner only.
 * - `'anonymise'`: irreversibly remove resource identity. Admin tier (owner | admin).
 * - `'transferOwnership'`: propose, cancel or finally approve an ownership transfer. Owner only.
 * - `'actOnOwnershipTransfer'`: reach the ownership-transfer ceremony at all. Admin tier, because
 *   the nominated Admin must be able to give or withdraw their own consent; participant identity
 *   decides each specific action.
 *
 * Invariant: this union is the closed vocabulary the matrix is exhaustive over (see {@link can}'s
 * `satisfies Record<Action, …>`): adding a member here without a rule fails to compile.
 */
export type Action =
  | "read"
  | "write"
  | "manageInternalClient"
  | "manageMembers"
  | "manageInvites"
  | "masquerade"
  | "manageMemberSignInTracking"
  | "anonymise"
  | "transferOwnership"
  | "actOnOwnershipTransfer";

// Product-data policy stays here; account-administration policy lives in account/policy.ts. Both
// use the account boundary's one canonical role ordering.

// Account policy owns administration thresholds; this table owns product-data thresholds.
// Record coverage makes a missing product-data rule a compile-time error.
const MIN_TIER = {
  read: "viewer",
  write: "editor",
  manageInternalClient: "admin",
  anonymise: "admin",
} as const satisfies Record<ProductDataAction, Role>;

// Map CapacityLens action names to canonical account-administration operations.
// Account policy owns the role thresholds so this table cannot duplicate them.
const ACCOUNT_ADMIN_ACTION = {
  manageMembers: "manage-members",
  manageInvites: "manage-invitations",
  masquerade: "masquerade-member",
  manageMemberSignInTracking: "manage-member-sign-in-tracking",
  transferOwnership: "transfer-ownership",
  actOnOwnershipTransfer: "act-on-ownership-transfer",
} as const satisfies Record<AccountAdministrationAction, AccountAdminAction>;

type ProductDataAction = "read" | "write" | "manageInternalClient" | "anonymise";
type AccountAdministrationAction = Exclude<Action, ProductDataAction>;

/** Check the resolved account role against product or account-administration policy. Pure; unknown roles or actions return false. */
export function can(role: Role, action: Action): boolean {
  const accountAction = (ACCOUNT_ADMIN_ACTION as Partial<Record<Action, AccountAdminAction>>)[action];
  if (accountAction !== undefined) return canAdministerAccount(role, accountAction);
  const minRole = (MIN_TIER as Partial<Record<Action, Role>>)[action];
  return minRole !== undefined && isAtLeastCanonicalRole(role, minRole);
}

/** Compare resolved roles in the viewer, editor, admin, owner hierarchy.
 * Pure; unknown roles return false. Canonical account policy owns the ordering. */
export function isAtLeast(role: Role, min: Role): boolean {
  return isAtLeastCanonicalRole(role, min);
}

/** Check whether an actor may change a target member to the requested role.
 * Pure; requires admin tier and refuses changes to or from owner, which require atomic ownership transfer.
 * The server independently enforces the single-owner invariant. */
export function canManageMemberRole(actorRole: Role, targetRole: Role, nextRole: Role): boolean {
  return canManageCanonicalMemberRole(actorRole, targetRole, nextRole);
}

/** Check whether an actor may edit a target member’s role before choosing a destination role.
 * Pure; requires admin tier and a recognised non-owner target.
 * Use canManageMemberRole to judge a selected destination. */
export function canEditAnyMemberRole(actorRole: Role, targetRole: Role): boolean {
  return canEditAnyCanonicalMemberRole(actorRole, targetRole);
}

/** Check whether an actor may remove a target member.
 * Pure; requires admin tier and a recognised non-owner target.
 * Transfer ownership before removing the current owner; the server independently enforces the single-owner invariant. */
export function canRemoveMember(actorRole: Role, targetRole: Role): boolean {
  return canRemoveCanonicalMember(actorRole, targetRole);
}

/** Check whether an actor may disable, archive or restore a target membership.
 * Pure; uses removal authority and refuses self-operation to prevent administrator lockout. */
export function canChangeMemberStatus(actorRole: Role, targetRole: Role, isSelf: boolean): boolean {
  return canChangeCanonicalMemberStatus(actorRole, targetRole, isSelf);
}

/** Check password-reset authority across every workspace the target can enter.
 * The actor needs sufficient authority in every target workspace; self-reset only requires a nonempty membership map.
 * Pure; callers supply trusted membership snapshots and separately enforce route/session policy. */
export function canResetMemberAcrossAccounts(
  actorRolesByAccount: ReadonlyMap<string, Role>,
  targetRolesByAccount: ReadonlyMap<string, Role>,
  isSelf: boolean,
): boolean {
  return canAdministerIdentityAcrossWorkspaces(actorRolesByAccount, targetRolesByAccount, isSelf);
}

/** Check whether the caller may see a time-off note.
 * Pure; only owners and admins may see it. This narrows an allowed read payload independently of route authorization. */
export function canSeeTimeOffNote(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Field-level visibility rule for private client/project real names and their stored code-name
 * settings. This is intentionally stricter than time-off notes: the account owner is the sole role
 * that receives the real name; admins, editors and viewers receive the quoted code-name projection.
 */
export function canSeePrivateNames(role: Role): boolean {
  return role === "owner";
}

/**
 * Decide whether a member may open Capacity Overview under an account's access setting.
 *
 * Pure: no I/O or session state. An absent or malformed setting fails closed to the documented
 * owner/admin default so direct-route callers cannot accidentally expose the page.
 */
export function canViewCapacityOverview(role: Role, access: CapacityOverviewAccess | undefined): boolean {
  if (access === "everyone") return true;
  if (access === "owner_admin_editor") return role === "owner" || role === "admin" || role === "editor";
  return role === "owner" || role === "admin";
}
