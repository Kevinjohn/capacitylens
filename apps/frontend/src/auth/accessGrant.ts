import type { AccessGrant, PermissionKey } from '@capacitylens/shared/domain/access'

/** The server's grant fields from a directory row or view-as state, or null when any is malformed. */
export function parseAccessGrant(record: Record<string, unknown>): AccessGrant | null {
  const { permissions, canSeePrivateNames, canSeeTimeOffNote } = record
  if (
    !Array.isArray(permissions) ||
    !permissions.every((key) => typeof key === 'string') ||
    typeof canSeePrivateNames !== 'boolean' ||
    typeof canSeeTimeOffNote !== 'boolean'
  ) {
    return null
  }
  return { permissions: permissions as PermissionKey[], canSeePrivateNames, canSeeTimeOffNote }
}
