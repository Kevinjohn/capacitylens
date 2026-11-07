import type { Role } from './types.js';
import { isAccountRole } from './types.js';
import type { Action } from '../domain/access.js';

/** Roles lowest first; the Access Control package requires the owner role last. */
export const accessRoles = ['viewer', 'editor', 'admin', 'owner'] as const;

/** resource -> action -> lowest role allowed. The package reserves members:list, members:manage and invitations:manage. */
export const accessPermissions = {
  planning: { read: 'viewer', write: 'editor' },
  members: { list: 'admin', manage: 'admin', signInTracking: 'owner' },
  invitations: { manage: 'admin' },
  internalClient: { manage: 'admin' },
  resources: { anonymise: 'admin' },
  catalogue: { deleteArchived: 'admin', restoreDeleted: 'admin' },
  viewAs: { use: 'admin' },
  ownership: { transfer: 'owner', participate: 'admin' },
} as const satisfies Record<string, Record<string, Role>>;

type KeysOf<P> = { [R in keyof P & string]: `${R}:${keyof P[R] & string}` }[keyof P & string];
/** 'planning:read' | 'planning:write' | ... */
export type PermissionKey = KeysOf<typeof accessPermissions>;

export const PERMISSION_KEYS: readonly PermissionKey[] = Object.freeze(
  Object.entries(accessPermissions).flatMap(([resource, actions]) =>
    Object.keys(actions).map((action) => `${resource}:${action}` as PermissionKey),
  ),
);

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** Maps every existing product Action to one package permission key. Exhaustive by construction. */
export const actionPermission = {
  read: 'planning:read',
  write: 'planning:write',
  manageInternalClient: 'internalClient:manage',
  manageMembers: 'members:manage',
  manageInvites: 'invitations:manage',
  masquerade: 'viewAs:use',
  manageMemberSignInTracking: 'members:signInTracking',
  anonymise: 'resources:anonymise',
  transferOwnership: 'ownership:transfer',
  actOnOwnershipTransfer: 'ownership:participate',
} as const satisfies Record<Action, PermissionKey>;

/** The current principal's authority in one company, as the account summary carries it. */
export interface CompanyAccess {
  scopeId: string;
  role: Role;
  permissions: PermissionKey[];
  assignableRoles: Role[];
}

/** Server-derived member-row controls; the server authorizes every operation independently. */
export interface MemberActions {
  changeRole: boolean;
  changeStatus: boolean;
  remove: boolean;
  enableAccess: boolean;
  viewAs: boolean;
}

/** Validates an untrusted access payload against the summary it arrived with. Null fails closed. */
export function parseCompanyAccess(
  value: unknown,
  expected: { scopeId: string; role: Role },
): CompanyAccess | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.scopeId !== expected.scopeId || v.role !== expected.role) return null;
  if (!Array.isArray(v.permissions) || !v.permissions.every(isPermissionKey)) return null;
  if (
    !Array.isArray(v.assignableRoles) ||
    !v.assignableRoles.every((r) => isAccountRole(r) && r !== 'owner')
  ) {
    return null;
  }
  return {
    scopeId: v.scopeId,
    role: expected.role,
    permissions: [...new Set(v.permissions)],
    assignableRoles: [...v.assignableRoles],
  };
}

const actionFlags = ['changeRole', 'changeStatus', 'remove', 'enableAccess', 'viewAs'] as const;

/** Validates member-row action flags. Any missing or non-boolean flag fails closed to null. */
export function parseMemberActions(value: unknown): MemberActions | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!actionFlags.every((flag) => typeof v[flag] === 'boolean')) return null;
  return Object.fromEntries(actionFlags.map((flag) => [flag, v[flag]])) as unknown as MemberActions;
}
