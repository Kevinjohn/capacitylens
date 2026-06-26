import { createContext, useContext } from 'react'
import { can, type Role } from '@capacitylens/shared/domain/access'

// Client permission context (production plan P1.12), kept separate from PermissionProvider so this
// file exports only the context + hooks (react-refresh clean) and consumers (affordance hubs:
// dialogs, the scheduler, the toolbar) don't import the provider machinery. It mirrors the split in
// authContext.ts / AuthProvider.tsx.
//
// THE NULL-DEFAULT IS THE OFF/DEMO REGRESSION GUARD. A `null` role resolves to EDITABLE everywhere
// (useCanEdit → true). That covers every path where there is no real membership role to enforce:
//   - OFF mode (the default, shipped deploy — must be byte-identical to today's no-login app);
//   - the demo build (VITE_CAPACITYLENS_DEMO=1 — no server, no roles);
//   - the role not yet fetched (boot), or no provider at all (unit tests / isolated renders).
// The server 403 (P1.5) is the AUTHORITATIVE access boundary; this client gating is UX +
// defense-in-depth. So failing OPEN to editable here is safe — a Viewer is still blocked server-side.

/** The resolved permission state for the ACTIVE account. `role: null` means "no role to enforce"
 *  (OFF / demo / not-yet-fetched / no-provider) and resolves to fully editable — see the module
 *  header. A concrete {@link Role} (auth-on + server) is fed into the pure `can` matrix. */
export interface PermissionContextValue {
  role: Role | null
}

export const PermissionContext = createContext<PermissionContextValue>({ role: null })

/**
 * The caller's resolved {@link Role} for the ACTIVE account, or `null`.
 *
 * `null` is the deliberate default (OFF / demo / not-yet-fetched / no provider — see the module
 * header): it is NOT "no access", it is "no role to enforce", and {@link useCanEdit} treats it as
 * editable. A concrete role is only ever present in an auth-on, server-backed deploy.
 *
 * @returns the active account's role, or `null` when there is no membership role to enforce.
 */
export function useRole(): Role | null {
  return useContext(PermissionContext).role
}

/**
 * May the current user EDIT (create / update / delete) the active account's scheduling data?
 *
 * The single client affordance gate (P1.12): the affordance hubs (ListPage / EmptyState / Edit /
 * Delete, the scheduler draw/drag/resize, the toolbar draw-toggle + undo/redo) call THIS to decide
 * whether to render an edit affordance. It is single-sourced from the pure {@link can} matrix, the
 * SAME authority the server's route guard uses, so client and server can't drift.
 *
 * `role === null` → `true` (editable): the OFF/demo/not-fetched/no-provider regression guard (see
 * the module header). Otherwise it is exactly `can(role, 'write')` — `true` for owner/admin/editor,
 * `false` for a viewer. The server 403 remains the true backstop; this is UX + defense-in-depth.
 *
 * @returns `true` when edit affordances should be shown; `false` only for a resolved `viewer`.
 */
export function useCanEdit(): boolean {
  const role = useRole()
  return role === null ? true : can(role, 'write')
}
