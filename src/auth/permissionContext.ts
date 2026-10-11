import { createContext, useContext } from "react";
import { can } from "@capacitylens/shared/domain/access";
import type { Action, Role } from "@capacitylens/shared/domain/access";
import { useStore } from "@/store/useStore";

// A null role means no membership role applies in off mode, demo mode, or providerless contexts.
// Authenticated server lookups project unresolved memberships to Viewer; masquerading independently
// denies every action except read.

/** The resolved permission state for the active account. A null role means no membership applies. */
export interface PermissionContextValue {
  role: Role | null;
  /** Resolution state is separate from the fail-closed role projection. During a pending or failed
   * authenticated lookup `role` remains Viewer for affordance safety, while explanatory UI can say
   * that access is being checked or is unavailable instead of claiming Viewer is authoritative. */
  status?: "not-applicable" | "pending" | "resolved" | "unavailable";
}

/** Context for the active account role and permission-check status. */
export const PermissionContext = createContext<PermissionContextValue>({ role: null, status: "not-applicable" });

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
export function usePermissionStatus(): NonNullable<PermissionContextValue["status"]> {
  const value = useContext(PermissionContext);
  return value.status ?? (value.role === null ? "not-applicable" : "resolved");
}

/**
 * May the current user perform `action` in the active account?
 *
 * The single client affordance gate for every capability, not just editing: a surface asks
 * for the one {@link Action} it is gating (`'write'`, `'purge'`, `'manageMembers'`, …) instead of
 * re-deriving a role test inline. It is single-sourced from the pure {@link can} matrix, the same
 * authority the server's route guard uses, so client and server can't drift.
 *
 * A null role permits the action when no membership applies, except that masquerading denies every
 * action other than read. Authenticated server lookups project unresolved memberships to Viewer.
 * Otherwise the pure `can` matrix decides the action; the server route guard remains authoritative.
 *
 * @param action - the capability the calling surface is gating.
 * @returns `true` when the affordance should be shown.
 */
export function useCan(action: Action): boolean {
  const masqueradeKind = useStore((state) => state.masquerade.kind);
  const role = useRole();
  if (action !== "read" && masqueradeKind !== "inactive") return false;
  return role === null ? true : can(role, action);
}

/**
 * Gate scheduling, planning, and configuration edit affordances for the active account.
 * It follows `useCan('write')`.
 *
 * @returns `true` when the effective role permits editing and masquerading is inactive.
 */
export function useCanEdit(): boolean {
  return useCan("write");
}
