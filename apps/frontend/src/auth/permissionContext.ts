import { createContext, useContext } from 'react';
import type { Role } from '@capacitylens/shared/domain/access';
import { actionPermission } from '@capacitylens/shared/account/permissions';
import type { CompanyAccess } from '@capacitylens/shared/account/permissions';
import { isServerConfigured } from '@/data/apiConfig';
import { useStore } from '@/store/useStore';

/** A guarded product capability; every one maps to exactly one shared permission key. */
export type Action = keyof typeof actionPermission;

// Server mode trusts only the server-derived authority snapshot; the in-memory demo acts as Owner,
// which holds every permission. Masquerading independently denies every action except read.

/** The resolved permission state for the active account. A null role means no membership applies. */
export interface PermissionContextValue {
  role: Role | null;
  /** Resolution state is separate from the fail-closed role projection. During a pending or failed
   * authenticated lookup `role` remains Viewer for affordance safety, while explanatory UI can say
   * that access is being checked or is unavailable instead of claiming Viewer is authoritative. */
  status?: 'not-applicable' | 'pending' | 'resolved' | 'unavailable';
  /** Server-derived authority for the active company. Null until a lookup resolves with valid
   * access. Held only in memory. */
  access?: CompanyAccess | null;
}

/** Context for the active account role, permission-check status and authority snapshot. */
export const PermissionContext = createContext<PermissionContextValue>({
  role: null,
  status: 'not-applicable',
  access: null,
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

/** The server-derived authority snapshot for the active company, or null when none is resolved. */
export function useCompanyAccess(): CompanyAccess | null {
  return useContext(PermissionContext).access ?? null;
}

/**
 * May the current user perform `action` in the active account?
 *
 * The single client affordance gate for every capability. In server mode it reads only the
 * resolved, server-derived permission list; a missing provider, a pending or unavailable lookup, or
 * a masquerade transition denies. Masquerading permits read only. Demo mode allows everything, as
 * its Owner would. The server remains authoritative for every request.
 *
 * @param action - the capability the calling surface is gating.
 * @returns `true` when the affordance should be shown.
 */
export function useCan(action: Action): boolean {
  const masquerade = useStore((s) => s.masquerade);
  const value = useContext(PermissionContext);
  if (!isServerConfigured()) return true;
  if (value.status !== 'resolved' || !value.access) return false;
  if (masquerade.kind === 'starting' || masquerade.kind === 'ending') return false;
  const allowed = value.access.permissions.includes(actionPermission[action]);
  return allowed && (masquerade.kind === 'inactive' || action === 'read');
}

/**
 * Gate scheduling, planning, and configuration edit affordances for the active account.
 * It follows `useCan('write')`.
 *
 * @returns `true` when the authority snapshot permits editing and masquerading is inactive.
 */
export function useCanEdit(): boolean {
  return useCan('write');
}
