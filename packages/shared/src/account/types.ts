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
  // `Date.parse` yields NaN for anything outside the representable range, so the date is valid here.
  if (!Number.isFinite(milliseconds)) return false;
  return new Date(milliseconds).toISOString() === value;
}

/** Every membership role, most to least privileged. */
export const ROLES = Object.freeze(['owner', 'admin', 'editor', 'viewer'] as const);
/** A membership role; see {@link ROLES}. */
export type Role = (typeof ROLES)[number];
/** Narrow an untrusted value to a known {@link Role}. Pure. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
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
