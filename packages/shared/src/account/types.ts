/**
 * Account vocabulary shared by the browser and the server.
 *
 * This module is deliberately a pure leaf: it must stay safe to import from either side without
 * pulling in a framework, the database or React.
 */

/** Opaque company (workspace) identifier. */
export type WorkspaceId = string;
/** Opaque identity-global principal (user) identifier. */
export type PrincipalId = string;
/** Canonical UTC instant produced by `Date#toISOString()`, including exactly three millisecond
 * digits and a trailing `Z` (for example `2026-07-18T10:00:00.000Z`). */
export type IsoInstant = string;
/** True only for a string that round-trips exactly through `Date#toISOString()`. Pure. */
export function isIsoInstant(value: unknown): value is IsoInstant {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  try {
    return new Date(milliseconds).toISOString() === value;
  } catch {
    // Date values outside the ISO range cannot be represented canonically.
    return false;
  }
}

/** Whether the app runs against the server's password sign-in or as the unauthenticated demo. */
export type AccountMode = 'off' | 'password-only';

/** Every membership role, most to least privileged. */
export const ACCOUNT_ROLES = Object.freeze(['owner', 'admin', 'editor', 'viewer'] as const);
/** A membership role; see {@link ACCOUNT_ROLES}. */
export type Role = (typeof ACCOUNT_ROLES)[number];
/** Narrow an untrusted value to a known {@link Role}. Pure. */
export function isAccountRole(value: unknown): value is Role {
  return typeof value === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(value);
}
/**
 * The lifecycle state of one membership, as the Access Control package stores it. Only `'active'`
 * confers authority; a `'suspended'` membership keeps its role and blocks entry until restored.
 */
export const MEMBERSHIP_STATUSES = Object.freeze(['active', 'suspended'] as const);
/** A membership lifecycle state; see {@link MEMBERSHIP_STATUSES}. */
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
/** Narrow an untrusted value to a known {@link MembershipStatus}. Pure. */
export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

/** Roles an invitation may grant. Ownership moves only through an ownership transfer. */
export type InvitationRole = Exclude<Role, 'owner'>;

/** Non-secret result of one completed atomic ownership handover. */
export interface OwnershipTransferReceipt {
  fromUserId: string;
  toUserId: string;
}
