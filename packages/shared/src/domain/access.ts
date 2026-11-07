// CapacityLens product action names and field-visibility rules. Role thresholds and membership
// administration live in the Access Control declaration (`account/permissions.ts`), which the
// server enforces; the browser reads its server-derived snapshot. These pure rules narrow payloads.
import type { Role } from '../account/types.js';
import type { CapacityOverviewAccess } from '../types/entities.js';
export type { Role } from '../account/types.js';

/**
 * A guarded product capability. These are coarse policy *actions* (not 1:1 with HTTP routes); the
 * server's `assertCompanyAction` maps each onto one Access Control permission key through
 * `actionPermission`, whose declared threshold sets the tier documented per member:
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
 * Invariant: `actionPermission` is `satisfies Record<Action, PermissionKey>`, so adding a member
 * here without a permission key fails to compile.
 */
export type Action =
  | 'read'
  | 'write'
  | 'manageInternalClient'
  | 'manageMembers'
  | 'manageInvites'
  | 'masquerade'
  | 'manageMemberSignInTracking'
  | 'anonymise'
  | 'transferOwnership'
  | 'actOnOwnershipTransfer';

/** Check whether the caller may see a time-off note.
 * Pure; only owners and admins may see it. This narrows an allowed read payload independently of route authorization. */
export function canSeeTimeOffNote(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

export function canReadInactiveExport(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Field-level visibility rule for private client/project real names and their stored code-name
 * settings. This is intentionally stricter than time-off notes: the account owner is the sole role
 * that receives the real name; admins, editors and viewers receive the quoted code-name projection.
 */
export function canSeePrivateNames(role: Role): boolean {
  return role === 'owner';
}

/**
 * Decide whether a member may open Capacity Overview under an account's access setting.
 *
 * Pure: no I/O or session state. An absent or malformed setting fails closed to the documented
 * owner/admin default so direct-route callers cannot accidentally expose the page.
 */
export function canViewCapacityOverview(
  role: Role,
  access: CapacityOverviewAccess | undefined,
): boolean {
  if (access === 'everyone') return true;
  if (access === 'owner_admin_editor') {
    return role === 'owner' || role === 'admin' || role === 'editor';
  }
  return role === 'owner' || role === 'admin';
}
