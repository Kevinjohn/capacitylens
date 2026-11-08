// CapacityLens permissions. `accessPermissions` is the one declaration: the server builds the
// Access Control package from it and enforces it; the browser reads it only to show or hide controls.
import type { Role } from '../account/types.js';
import type { CapacityOverviewAccess } from '../types/entities.js';
export type { Role } from '../account/types.js';

/** Roles lowest first; the Access Control package requires the owner role last. */
export const accessRoles = [
  'viewer',
  'editor',
  'admin',
  'owner',
] as const satisfies readonly Role[];

/** resource -> action -> lowest role allowed. The package requires the members and invitations keys. */
export const accessPermissions = {
  planning: { read: 'viewer', write: 'editor' },
  members: { list: 'admin', manage: 'admin', signInTracking: 'owner' },
  invitations: { manage: 'admin' },
  viewAs: { use: 'admin' },
  resources: { anonymise: 'admin' },
  catalogue: { manage: 'admin' },
  ownership: { transfer: 'owner' },
} as const satisfies Record<string, Record<string, Role>>;

type Permissions = typeof accessPermissions;
/** `'planning:read' | 'planning:write' | ...` */
export type PermissionKey = {
  [R in keyof Permissions]: `${R}:${keyof Permissions[R] & string}`;
}[keyof Permissions];

/** Reports whether `role` reaches the lowest role declared for `key`. Unknown roles and keys return false. */
export function can(role: Role, key: PermissionKey): boolean {
  const [resource, action] = key.split(':') as [keyof Permissions, string];
  const lowest = (accessPermissions[resource] as Record<string, Role> | undefined)?.[action];
  return lowest !== undefined && accessRoles.indexOf(role) >= accessRoles.indexOf(lowest);
}

/** Check whether the caller may see a time-off note.
 * Pure; only owners and admins may see it. This narrows an allowed read payload independently of route authorization. */
export function canSeeTimeOffNote(role: Role): boolean {
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
