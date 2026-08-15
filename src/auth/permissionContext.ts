import { createContext, useContext } from "react";
import { can, type Action, type Role } from "@capacitylens/shared/domain/access";

// Client permission context (production plan P1.12), kept separate from PermissionProvider so this
// file exports only the context + hooks (react-refresh clean) and consumers (affordance hubs:
// dialogs, the scheduler, the toolbar) don't import the provider machinery. It mirrors the split in
// authContext.ts / AuthProvider.tsx.
//
// THE NULL-DEFAULT IS THE OFF/DEMO REGRESSION GUARD. A `null` role resolves to PERMITTED everywhere
// (useCan → true for every action, and so useCanEdit → true). That covers every path where there is
// no real membership role to enforce:
//   - OFF mode (the default, shipped deploy — must be byte-identical to today's no-login app);
//   - the demo build (VITE_CAPACITYLENS_DEMO=1 — no server, no roles);
//   - no provider at all (unit tests / isolated renders).
// PermissionProvider never exposes null in an authenticated server account: pending, failed, missing,
// and malformed role lookups all project viewer so the UI cannot optimistically diverge.

/** The resolved permission state for the ACTIVE account. `role: null` means "no role to enforce"
 *  (OFF / demo / no-provider) and resolves to fully editable — see the module
 *  header. A concrete {@link Role} (auth-on + server) is fed into the pure `can` matrix. */
export interface PermissionContextValue {
  role: Role | null;
  /** Resolution state is separate from the fail-closed role projection. During a pending or failed
   * authenticated lookup `role` remains Viewer for affordance safety, while explanatory UI can say
   * that access is being checked or is unavailable instead of claiming Viewer is authoritative. */
  status?: "not-applicable" | "pending" | "resolved" | "unavailable";
}

export const PermissionContext = createContext<PermissionContextValue>({ role: null, status: "not-applicable" });

/**
 * The caller's resolved {@link Role} for the ACTIVE account, or `null`.
 *
 * `null` is the deliberate default (OFF / demo / no provider — see the module
 * header): it is NOT "no access", it is "no role to enforce", and {@link useCanEdit} treats it as
 * editable. A concrete role is only ever present in an auth-on, server-backed deploy.
 *
 * @returns the active account's role, or `null` when there is no membership role to enforce.
 */
export function useRole(): Role | null {
  return useContext(PermissionContext).role;
}

/** Status of the active membership lookup. Providerless test/isolated contexts retain the historic
 * role-only API: a concrete supplied role is resolved, while null means no membership applies. */
export function usePermissionStatus(): NonNullable<PermissionContextValue["status"]> {
  const value = useContext(PermissionContext);
  return value.status ?? (value.role === null ? "not-applicable" : "resolved");
}

/**
 * May the current user perform `action` in the active account?
 *
 * The single client affordance gate (P1.12) for EVERY capability, not just editing: a surface asks
 * for the one {@link Action} it is gating (`'write'`, `'purge'`, `'manageMembers'`, …) instead of
 * re-deriving a role test inline. It is single-sourced from the pure {@link can} matrix, the SAME
 * authority the server's route guard uses, so client and server can't drift.
 *
 * `role === null` → `true` for ANY action: the OFF/demo/no-provider regression guard (see the module
 * header). A null role is not "no access", it is "no role to enforce" — the shipped no-login deploy
 * and the demo build must stay byte-identical to the app before permissions existed, and they reach
 * every affordance through this rule. PermissionProvider never exposes null in an authenticated
 * server account (pending / failed / missing / malformed lookups all project viewer), so the
 * fail-OPEN default here is only ever reached where there is genuinely nothing to enforce.
 *
 * Otherwise it is exactly `can(role, action)`. The server 403 remains the true backstop; this is UX
 * + defense-in-depth.
 *
 * @param action - the capability the calling surface is gating.
 * @returns `true` when the affordance should be shown.
 */
export function useCan(action: Action): boolean {
  const role = useRole();
  return role === null ? true : can(role, action);
}

/**
 * May the current user EDIT (create / update / delete) the active account's scheduling data or
 * ordinary planning/display configuration?
 *
 * The named shorthand for the commonest gate — the affordance hubs (ListPage / EmptyState / Edit /
 * Delete, the scheduler draw/drag/resize, the toolbar draw-toggle + undo/redo, and Settings account
 * controls) call THIS to decide whether to render an edit affordance. Exactly {@link useCan}`('write')`,
 * including its null-role rule: `true` for owner/admin/editor, `false` only for a resolved viewer.
 *
 * @returns `true` when edit affordances should be shown; `false` only for a resolved `viewer`.
 */
export function useCanEdit(): boolean {
  return useCan("write");
}
