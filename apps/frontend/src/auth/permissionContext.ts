import { createContext, useContext } from 'react';
import { can } from '@capacitylens/shared/domain/access';
import type { PermissionKey, Role } from '@capacitylens/shared/domain/access';
import { useStore } from '@/store/useStore';

// A null role means no membership role applies in off mode, demo mode, or providerless contexts.
// Authenticated server lookups project unresolved memberships to Viewer; masquerading independently
// denies every permission key except `planning:read`.

/** The resolved permission state for the active account. A null role means no membership applies. */
export interface PermissionContextValue {
  role: Role | null;
  /** Resolution state is separate from the fail-closed role projection. During a pending or failed
   * authenticated lookup `role` remains Viewer for affordance safety, while explanatory UI can say
   * that access is being checked or is unavailable instead of claiming Viewer is authoritative. */
  status?: 'not-applicable' | 'pending' | 'resolved' | 'unavailable';
}

/** Context for the active account role and permission-check status. */
export const PermissionContext = createContext<PermissionContextValue>({
  role: null,
  status: 'not-applicable',
});

/**
 * The caller's resolved {@link Role} for the active account, or `null`.
 *
 * `null` means no membership role applies in off mode, demo mode, or providerless contexts.
 *
 * @returns the active account's role, or `null` when there is no membership role to enforce.
 */
export function useRole(): Role | null {
  return useContext(PermissionContext).role;
}

/** Status of the active membership lookup. Providerless contexts infer status from the supplied role. */
export function usePermissionStatus(): NonNullable<PermissionContextValue['status']> {
  const value = useContext(PermissionContext);
  return value.status ?? (value.role === null ? 'not-applicable' : 'resolved');
}

/**
 * May the current user use `key` in the active account? Shows or hides a control only; the server
 * enforces the same permission declaration on every request.
 *
 * A null role permits the key when no membership applies, except that masquerading denies every
 * key other than `planning:read`. Authenticated server lookups project unresolved memberships to
 * Viewer.
 *
 * @param key - the permission the calling surface is gating.
 * @returns `true` when the affordance should be shown.
 */
export function useCan(key: PermissionKey): boolean {
  const masqueradeKind = useStore((state) => state.masquerade.kind);
  const role = useRole();
  if (key !== 'planning:read' && masqueradeKind !== 'inactive') return false;
  return role === null ? true : can(role, key);
}

/**
 * Gate scheduling, planning, and configuration edit affordances for the active account.
 * It follows `useCan('planning:write')`.
 *
 * @returns `true` when the effective role permits editing and masquerading is inactive.
 */
export function useCanEdit(): boolean {
  return useCan('planning:write');
}
