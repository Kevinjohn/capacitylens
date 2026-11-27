import type { AccessGrant, Role } from '@capacitylens/shared/domain/access'
import { NO_ACCESS } from '@/auth/permissionContext'
import type { PermissionContextValue } from '@/auth/permissionContext'

// The grants the server sends per role, written out as literals. The backend test
// `tests/functional/auth/access_grant.spec.ts` pins the same lists against the server.
const GRANTS: Readonly<Record<Role, AccessGrant>> = {
  owner: {
    permissions: [
      'planning:read',
      'planning:write',
      'members:list',
      'members:manage',
      'members:signInTracking',
      'invitations:manage',
      'masquerade:use',
      'resources:anonymise',
      'ownership:transfer',
      'company:import',
      'company:anonymise',
    ],
    canSeePrivateNames: true,
    canSeeTimeOffNote: true,
  },
  admin: {
    permissions: [
      'planning:read',
      'planning:write',
      'members:list',
      'members:manage',
      'invitations:manage',
      'masquerade:use',
      'resources:anonymise',
    ],
    canSeePrivateNames: false,
    canSeeTimeOffNote: true,
  },
  editor: {
    permissions: ['planning:read', 'planning:write'],
    canSeePrivateNames: false,
    canSeeTimeOffNote: false,
  },
  viewer: {
    permissions: ['planning:read'],
    canSeePrivateNames: false,
    canSeeTimeOffNote: false,
  },
}

/** A fresh copy of the grant the server sends for `role`. */
export function grantFor(role: Role): AccessGrant {
  const grant = GRANTS[role]
  return { ...grant, permissions: [...grant.permissions] }
}

/** The grant the server sends while viewing as a member of `role`: the role's flags, read only. */
export function masqueradeGrantFor(role: Role): AccessGrant {
  return { ...grantFor(role), permissions: ['planning:read'] }
}

/**
 * A permission context value as the provider publishes it: the role's grant when resolved, and
 * {@link NO_ACCESS} for a null role or a pending, unavailable or not-applicable lookup.
 */
export function permissionValue(
  role: Role | null,
  status: NonNullable<PermissionContextValue['status']> = role === null
    ? 'not-applicable'
    : 'resolved'
): PermissionContextValue {
  return {
    role,
    status,
    grant: role !== null && status === 'resolved' ? grantFor(role) : NO_ACCESS,
  }
}
