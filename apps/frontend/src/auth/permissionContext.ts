import { createContext, useContext } from 'react';
import type { AccessGrant, PermissionKey, Role } from '@capacitylens/shared/domain/access';

// The server sends the effective member's grant: its permission keys and the field-visibility
// flags. The browser shows or hides permission-gated controls from the grant; a view-as grant holds
// only `planning:read`. The Owner-or-Admin, Capacity Overview and sole-Owner checks still read the
// role.

/** The most restricted grant: no keys and neither field flag. Pending and unavailable states use it. */
export const NO_ACCESS: AccessGrant = Object.freeze({
  permissions: [],
  canSeePrivateNames: false,
  canSeeTimeOffNote: false,
});

/** The resolved permission state for the active account. A null role means no membership applies. */
export interface PermissionContextValue {
  /** For display (badge and copy) only; decisions read `grant`. */
  role: Role | null;
  /** Resolution state of the membership lookup. While pending or unavailable `grant` is
   * {@link NO_ACCESS}, and explanatory UI can say that access is being checked or is unavailable. */
  status?: 'not-applicable' | 'pending' | 'resolved' | 'unavailable';
  /** What the server allows the effective member in the active account. */
  grant: AccessGrant;
}

/** Context for the active account role, its grant and the permission-check status. */
export const PermissionContext = createContext<PermissionContextValue>({
  role: null,
  status: 'not-applicable',
  grant: NO_ACCESS,
});

/**
 * The caller's {@link Role} for the active account, or `null`, for display only.
 *
 * `null` means no membership role applies in the current account context.
 *
 * @returns the active account's role, or `null` when there is no membership role.
 */
export function useRole(): Role | null {
  return useContext(PermissionContext).role;
}

/** Status of the active membership lookup. Providerless contexts infer status from the supplied role. */
export function usePermissionStatus(): NonNullable<PermissionContextValue['status']> {
  const value = useContext(PermissionContext);
  return value.status ?? (value.role === null ? 'not-applicable' : 'resolved');
}

/** The grant the server sent for the active account, or {@link NO_ACCESS} until one is resolved. */
export function useAccessGrant(): AccessGrant {
  return useContext(PermissionContext).grant;
}

/**
 * Reports whether the server's grant for the active account holds `key`. It shows or hides a
 * control only; the server enforces the permission on every request.
 *
 * @param key - the permission the calling surface is gating.
 * @returns `true` when the affordance should be shown.
 */
export function useCan(key: PermissionKey): boolean {
  return useAccessGrant().permissions.includes(key);
}

/**
 * Gate scheduling, planning, and configuration edit affordances for the active account.
 * It follows `useCan('planning:write')`.
 *
 * @returns `true` when the grant holds `planning:write`; a view-as grant never does.
 */
export function useCanEdit(): boolean {
  return useCan('planning:write');
}
