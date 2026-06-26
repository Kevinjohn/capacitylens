// Access control — the pure, environment-agnostic role vocabulary. This module is a types-only
// leaf (no runtime deps, no I/O, no session) so BOTH halves of the app can import it without
// pulling in anything heavier: the server (membership / control tables, P1.1) and, later, the
// client. Defining the role set ONCE here is what stops the server's notion of a role drifting
// from the client's.
//
// DECISION (P1.1): `Role` lands in shared from P1.1 — earlier than the permission matrix — because
// it is pure domain consumed by the server's membership control table NOW and by P1.3's `can()` +
// the client LATER. Single-sourcing it avoids two definitions drifting. P1.3 will ADD `Action`,
// `can(role, action)` and `canSeeTimeOffNote(role)` to THIS file (the pure policy matrix); this
// file deliberately holds only the `Role` type today.

/**
 * The account-wide access role a login holds for one account (the binding lives in the
 * `account_members` server-control table; see server/src/controlTables.ts).
 *
 * Role semantics (the single source of truth — mirrors the CapacityLens Decisions):
 * - `'owner'`  — every capability, INCLUDING ownership-transfer. Exactly one per account by
 *                convention; the only role that can hand the account to someone else.
 * - `'admin'`  — manage members + invites and purge (hard-delete) data; everything an editor can
 *                do, but NOT owner-only operations (ownership-transfer).
 * - `'editor'` — create / edit / delete scheduling data; cannot manage members, invites, or purge.
 * - `'viewer'` — read-only; no writes of any kind.
 *
 * INVARIANT: this is the ONLY definition of the role set. The pure permission matrix added in P1.3
 * (`can`) keys off exactly these four values; any new role must be added here first so both the
 * matrix and the membership table agree on the vocabulary.
 */
export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

/**
 * A guarded capability the access matrix gates. These are coarse policy *actions* (not 1:1 with
 * HTTP routes); P1.5's `requirePermission` maps each protected route onto one of these before
 * calling {@link can}. The required tier is documented per member:
 *
 * - `'read'`             — view an account's scheduling data. ANY member (owner | admin | editor | viewer).
 * - `'write'`            — create / edit / delete scheduling data. Editor and up (owner | admin | editor); NOT viewer.
 * - `'manageMembers'`    — add / remove members and change their roles. Admin tier (owner | admin).
 * - `'manageInvites'`    — create / revoke invites (link + email-preauth). Admin tier (owner | admin).
 * - `'purge'`            — hard-delete (purge) tombstoned data. Admin tier (owner | admin).
 * - `'transferOwnership'`— hand the account to another login. Owner ONLY.
 *
 * INVARIANT: this union is the closed vocabulary the matrix is exhaustive over (see {@link can}'s
 * `satisfies Record<Action, …>`): adding a member here without a rule fails to compile.
 */
export type Action =
  | 'read'
  | 'write'
  | 'manageMembers'
  | 'manageInvites'
  | 'purge'
  | 'transferOwnership'

// The role tiers are strictly nested for every gated Action (viewer ⊂ editor ⊂ admin ⊂ owner), so
// the matrix is encoded as a per-action MINIMUM TIER plus a role→rank lookup, rather than spelling
// out an allow-list per action. Higher rank = more capable; a role passes iff its rank ≥ the
// action's minimum-tier rank. Encoding "owner > admin > editor > viewer" once (here) keeps the
// matrix a single small table and makes "and up" literal — no per-action list can drift out of tier
// order. The named ranks (no magic numbers) below are the only place the ordering lives.
const ROLE_RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
} as const

/**
 * The minimum role required for each {@link Action} — the matrix from the CapacityLens Decisions
 * table, expressed as the lowest tier that may perform the action. A role satisfies an action iff
 * its {@link ROLE_RANK} is ≥ the rank of this minimum role.
 *
 * `satisfies Record<Action, Role>` is load-bearing: it makes the table exhaustive over `Action` at
 * COMPILE time, so a newly-added Action with no rule here is a build error rather than a silent
 * fail-open.
 */
const MIN_TIER = {
  read: 'viewer', // any member
  write: 'editor', // editor and up
  manageMembers: 'admin', // admin and up
  manageInvites: 'admin', // admin and up
  purge: 'admin', // admin and up
  transferOwnership: 'owner', // owner only
} as const satisfies Record<Action, Role>

/**
 * The single pure authority for "may this role perform this action" on an account. The server
 * (P1.5 `requirePermission`) resolves the caller's role for the account (a membership lookup) and
 * then calls THIS; the client (P1.12 `useCanEdit`) calls the SAME function for affordances — so the
 * permission decision is single-sourced and the two halves cannot drift.
 *
 * PURE by contract: no I/O, no session/Headers param, no Date, no randomness — just the role, the
 * action, and the static matrix. It is a leaf module (only depends on the {@link Role} type) so
 * both server and client can import it freely.
 *
 * INVARIANT: this is the ONLY place the role/action matrix is encoded. Affordance code and route
 * guards must call `can` rather than re-deriving "is this role an admin?" inline.
 *
 * Fail-closed: an unrecognised role or action yields `false` (the types prevent reaching this in
 * well-typed code; the guard is the safe default at an untyped boundary).
 *
 * @param role - the caller's resolved account role (see {@link Role}).
 * @param action - the capability being attempted (see {@link Action}).
 * @returns `true` iff `role` is at or above the action's required tier; `false` otherwise.
 */
export function can(role: Role, action: Action): boolean {
  const minRole = MIN_TIER[action]
  const have = ROLE_RANK[role]
  const need = ROLE_RANK[minRole]
  // Fail-closed at an untyped boundary: an unknown role/action makes a rank `undefined`, and any
  // comparison with `undefined` is `false` — so we deny rather than fall open.
  if (have === undefined || need === undefined) return false
  return have >= need
}

/**
 * Is `role` at or above the minimum tier `min` in the strict role hierarchy
 * (viewer ⊂ editor ⊂ admin ⊂ owner)? The pure tier-comparison primitive the member-management
 * guards below build on, single-sourced from {@link ROLE_RANK} so "and up" never drifts from the
 * matrix the {@link can} matrix already encodes.
 *
 * PURE: no I/O, no session — just the two roles. Fail-closed at an untyped boundary: an unrecognised
 * role makes a rank `undefined`, and any comparison with `undefined` is `false` — so it denies rather
 * than falls open (mirrors {@link can}).
 *
 * @param role - the role being tested.
 * @param min  - the minimum tier `role` must reach.
 * @returns `true` iff `ROLE_RANK[role] >= ROLE_RANK[min]`; `false` otherwise (incl. unknown roles).
 */
export function isAtLeast(role: Role, min: Role): boolean {
  const have = ROLE_RANK[role]
  const need = ROLE_RANK[min]
  if (have === undefined || need === undefined) return false
  return have >= need
}

/**
 * May `actorRole` change a member's role from `targetRole` to `nextRole`? The PURE policy behind
 * member-management role edits (P1.11) — single-sourced HERE so the client affordance and the server
 * route guard decide identically and cannot drift (the client uses it to hide controls; the server
 * is the backstop that actually enforces it).
 *
 * Rules (deny by default):
 * - The actor must hold `manageMembers` (admin-tier) at all — else `false`.
 * - NO admin→owner GRANT: only an owner may grant the `owner` role (`nextRole === 'owner'` requires
 *   `actorRole === 'owner'`). This closes the privilege-escalation path of an admin minting an owner.
 * - An admin may NOT touch an OWNER: changing an existing owner's role requires the actor be an owner
 *   (`targetRole === 'owner'` requires `actorRole === 'owner'`).
 *
 * NOT enforced here (needs DB I/O, so it lives server-side): the LAST-OWNER protection — refusing to
 * demote the sole remaining owner (a row count). This guard is the pure who-may-touch-whom matrix;
 * the count-based "can't strand the account ownerless" rule is enforced in the server route.
 *
 * PURE: no I/O, no session — just the three roles.
 *
 * @param actorRole  - the acting member's role.
 * @param targetRole - the role the target member currently holds.
 * @param nextRole   - the role the actor wants to set.
 * @returns `true` iff the role change is permitted by the pure matrix; `false` otherwise.
 */
export function canManageMemberRole(actorRole: Role, targetRole: Role, nextRole: Role): boolean {
  if (!can(actorRole, 'manageMembers')) return false
  // No admin→owner grant: only an owner may mint another owner.
  if (nextRole === 'owner' && actorRole !== 'owner') return false
  // An admin cannot touch an existing owner (only an owner may change an owner's role).
  if (targetRole === 'owner' && actorRole !== 'owner') return false
  return true
}

/**
 * May `actorRole` remove (revoke) a member holding `targetRole`? The PURE policy behind member
 * removal (P1.11) — single-sourced HERE alongside {@link canManageMemberRole} for the same
 * no-drift reason (client hides the control, server enforces it).
 *
 * Rules (deny by default):
 * - The actor must hold `manageMembers` (admin-tier) at all — else `false`.
 * - An admin may NOT remove an OWNER (`targetRole === 'owner'` requires `actorRole === 'owner'`).
 *
 * NOT enforced here (needs DB I/O): the LAST-OWNER protection — refusing to remove the sole remaining
 * owner. That count-based rule lives in the server route; this is the pure who-may-remove-whom matrix.
 *
 * PURE: no I/O, no session — just the two roles.
 *
 * @param actorRole  - the acting member's role.
 * @param targetRole - the role the member being removed currently holds.
 * @returns `true` iff the removal is permitted by the pure matrix; `false` otherwise.
 */
export function canRemoveMember(actorRole: Role, targetRole: Role): boolean {
  if (!can(actorRole, 'manageMembers')) return false
  // An admin cannot remove an owner (only an owner may remove an owner).
  if (targetRole === 'owner' && actorRole !== 'owner') return false
  return true
}

/**
 * Field-level visibility rule: only an owner or admin may see a time-off entry's `note`.
 *
 * Kept SEPARATE from the {@link Action} matrix on purpose — this is a *field-visibility* rule
 * (which columns to project), not a *route action* (whether to allow a request). The server
 * enforces it by redacting `note` from the read slice for everyone below admin (P1.6); the client
 * uses the same predicate to decide whether to render the field. It is not an `Action` because
 * there is no request to gate — the request (a read) is already allowed; this only narrows the
 * payload.
 *
 * PURE: no I/O, no session — just the role.
 *
 * @param role - the caller's resolved account role.
 * @returns `true` iff `role` is `'owner'` or `'admin'`.
 */
export function canSeeTimeOffNote(role: Role): boolean {
  return role === 'owner' || role === 'admin'
}
