// CapacityLens product permissions. Canonical account roles and administrative policy live in the
// provider-neutral account contract; this module adds product-data actions and field visibility.
// Both the browser and server import these pure rules so affordances and enforcement cannot drift.
import type { Role } from '../account/types'
import {
  canAdministerAccount,
  canAdministerIdentity,
  canAdministerIdentityAcrossWorkspaces,
  canManageMemberRole as canManageCanonicalMemberRole,
  canRemoveMember as canRemoveCanonicalMember,
  isAtLeast as isAtLeastCanonicalRole,
  type AccountAdminAction,
} from '../account/policy'
export type { Role } from '../account/types'

/**
 * A guarded capability the access matrix gates. These are coarse policy *actions* (not 1:1 with
 * HTTP routes); `requirePermission` maps each protected route onto one of these before
 * calling {@link can}. The required tier is documented per member:
 *
 * - `'read'`             — view an account's scheduling data. ANY member (owner | admin | editor | viewer).
 * - `'write'`            — create / edit / delete scheduling data. Editor and up (owner | admin | editor); NOT viewer.
 * - `'manageMembers'`    — add / remove members and change their roles. Admin tier (owner | admin).
 * - `'manageInvites'`    — create / revoke invites (link + email-preauth). Admin tier (owner | admin).
 * - `'purge'`            — hard-delete (purge) tombstoned data. Admin tier (owner | admin).
 * - `'deleteAccount'`    — erase an entire account and its members' orphaned identities. Owner ONLY.
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
  | 'deleteAccount'
  | 'transferOwnership'

// Product-data policy stays here; account-administration policy lives in account/policy.ts. Both
// use the account boundary's one canonical role ordering.

/**
 * The minimum role required for CapacityLens product-data actions. Account administration is
 * delegated to `canAdministerAccount` below and has no duplicate thresholds in this module.
 *
 * `satisfies Record<ProductDataAction, Role>` is load-bearing: a newly-added product-data action
 * with no rule is a build error rather than a silent fail-open.
 */
const MIN_TIER = {
  read: 'viewer', // any member
  write: 'editor', // editor and up
  purge: 'admin', // admin and up
} as const satisfies Record<ProductDataAction, Role>

/** CapacityLens names mapped to the account boundary's canonical administrative operations.
 * This table deliberately contains no role thresholds: account policy owns those exactly once. */
const ACCOUNT_ADMIN_ACTION = {
  manageMembers: 'manage-members',
  manageInvites: 'manage-invitations',
  deleteAccount: 'erase-workspace',
  transferOwnership: 'transfer-ownership',
} as const satisfies Record<AccountAdministrationAction, AccountAdminAction>

type ProductDataAction = 'read' | 'write' | 'purge'
type AccountAdministrationAction = Exclude<Action, ProductDataAction>

/**
 * The single pure authority for "may this role perform this action" on an account. The server
 * resolves the caller's role for the account and then calls this function; the client uses the
 * same function for affordances, so the
 * permission decision is single-sourced and the two halves cannot drift.
 *
 * PURE by contract: no I/O, no session/Headers param, no Date, no randomness — just the role, the
 * action, and the static matrix. It is a leaf module (only depends on the {@link Role} type) so
 * both server and client can import it freely.
 *
 * INVARIANT: product-data thresholds are encoded here; account-administration thresholds are
 * encoded in `account/policy.ts`. Affordances and route guards call `can` rather than re-deriving
 * role tests inline.
 *
 * Fail-closed: an unrecognised role or action yields `false` (the types prevent reaching this in
 * well-typed code; the guard is the safe default at an untyped boundary).
 *
 * @param role - the caller's resolved account role (see {@link Role}).
 * @param action - the capability being attempted (see {@link Action}).
 * @returns `true` iff `role` is at or above the action's required tier; `false` otherwise.
 */
export function can(role: Role, action: Action): boolean {
  const accountAction = (ACCOUNT_ADMIN_ACTION as Partial<Record<Action, AccountAdminAction>>)[action]
  if (accountAction !== undefined) return canAdministerAccount(role, accountAction)
  const minRole = (MIN_TIER as Partial<Record<Action, Role>>)[action]
  return minRole !== undefined && isAtLeastCanonicalRole(role, minRole)
}

/**
 * Is `role` at or above the minimum tier `min` in the strict role hierarchy
 * (viewer ⊂ editor ⊂ admin ⊂ owner)? The pure tier-comparison primitive the member-management
 * guards below build on, delegated to the neutral account policy so "and up" never drifts from
 * account administration.
 *
 * PURE: no I/O, no session — just the two roles. Fail-closed at an untyped boundary: an unrecognised
 * role makes a rank `undefined`, and any comparison with `undefined` is `false` — so it denies rather
 * than falls open (mirrors {@link can}).
 *
 * @param role - the role being tested.
 * @param min  - the minimum tier `role` must reach.
 * @returns `true` iff the canonical account tier for `role` reaches `min`; `false` otherwise.
 */
export function isAtLeast(role: Role, min: Role): boolean {
  return isAtLeastCanonicalRole(role, min)
}

/**
 * May `actorRole` change a member's role from `targetRole` to `nextRole`? The PURE policy behind
 * member-management role edits — single-sourced here so the client affordance and the server
 * route guard decide identically and cannot drift (the client uses it to hide controls; the server
 * is the backstop that actually enforces it).
 *
 * Rules (deny by default):
 * - The actor must hold `manageMembers` (admin-tier) at all — else `false`.
 * - `owner` is never an ordinary role change. Promoting a non-owner or demoting the current Owner
 *   both require the explicit atomic ownership-transfer operation, so this guard refuses either.
 * - Admin may not touch the Owner; Owner may manage only non-owner membership roles here.
 *
 * The server database independently enforces the exactly-one-owner invariant.
 *
 * PURE: no I/O, no session — just the three roles.
 *
 * @param actorRole  - the acting member's role.
 * @param targetRole - the role the target member currently holds.
 * @param nextRole   - the role the actor wants to set.
 * @returns `true` iff the role change is permitted by the pure matrix; `false` otherwise.
 */
export function canManageMemberRole(actorRole: Role, targetRole: Role, nextRole: Role): boolean {
  return canManageCanonicalMemberRole(actorRole, targetRole, nextRole)
}

/**
 * May `actorRole` remove (revoke) a member holding `targetRole`? The PURE policy behind member
 * removal — single-sourced here alongside {@link canManageMemberRole} for the same
 * no-drift reason (client hides the control, server enforces it).
 *
 * Rules (deny by default):
 * - The actor must hold `manageMembers` (admin-tier) at all — else `false`.
 * - The Owner is never removable. Ownership must first be transferred to another existing member;
 *   that atomic operation steps the former Owner down to Admin, after which ordinary removal applies.
 *
 * The server database independently enforces the exactly-one-owner invariant.
 *
 * PURE: no I/O, no session — just the two roles.
 *
 * @param actorRole  - the acting member's role.
 * @param targetRole - the role the member being removed currently holds.
 * @returns `true` iff the removal is permitted by the pure matrix; `false` otherwise.
 */
export function canRemoveMember(actorRole: Role, targetRole: Role): boolean {
  return canRemoveCanonicalMember(actorRole, targetRole)
}

/**
 * May `actorRole` issue a password-reset link for a member holding `targetRole`? The PURE policy
 * behind admin-issued reset links — single-sourced here alongside {@link canRemoveMember}
 * for the same no-drift reason (client hides the control, server enforces it).
 *
 * Rules (deny by default — same who-may-touch-whom shape as removal, because a reset link IS an
 * account-takeover capability: whoever holds it can sign in as the target):
 * - The actor must hold `manageMembers` (admin-tier) at all — else `false`.
 * - An admin may NOT reset an OWNER's password (`targetRole === 'owner'` requires
 *   `actorRole === 'owner'`) — otherwise an admin could mint an owner-session for themselves,
 *   the exact privilege-escalation path the no-admin→owner-grant rule closes elsewhere.
 *
 * Self-reset is deliberately permitted by this matrix (an owner resetting the owner row passes):
 * it is harmless — the actor already holds that session — and useful when a social-sign-in user
 * wants a password set for them.
 *
 * PURE: no I/O, no session — just the two roles.
 *
 * @param actorRole  - the acting member's role.
 * @param targetRole - the role of the member whose password would be reset.
 * @returns `true` iff issuing the reset link is permitted by the pure matrix; `false` otherwise.
 */
export function canResetMemberPassword(actorRole: Role, targetRole: Role): boolean {
  return canAdministerIdentity(actorRole, targetRole)
}

/**
 * May `actor` issue a password-reset link for `target`, judged across EVERY account the target
 * belongs to?
 *
 * A reset link sets the target's Better Auth credential, which is account-GLOBAL: whoever redeems it
 * can sign in as the target into EVERY account the target is a member of. So the per-account
 * {@link canResetMemberPassword} check on the acting account alone is NOT enough — it would let an
 * admin of account X mint a link for a user who is a mere editor in X but the OWNER of account Y,
 * handing X's admin a takeover of Y (reachable under CAPACITYLENS_MULTI_ACCOUNT, where one identity
 * holds memberships in several accounts). Even an OWNER of X must not reset a user who owns Y — X's
 * owner has no standing in Y.
 *
 * The invariant: the actor may reset the target ONLY IF, in every account the target is a member of,
 * the actor is ALSO a member there with a role that {@link canResetMemberPassword} permits over the
 * target's role there. In the single-account default (the target belongs to exactly the acting
 * account) this reduces exactly to the per-account check.
 *
 * SELF-RESET EXEMPTION (`isSelf === true`): the cross-account escalation the loop defends against is
 * "actor mints a link that takes over SOMEONE ELSE's global identity". When actor === target there is
 * no such target — you cannot escalate against your own identity, because you already hold that
 * session. So for a self-reset the cross-account authority check is skipped entirely and we require
 * only the fail-closed non-empty-map rule (`size > 0` — a self with zero memberships is not a real
 * identity). This is what keeps the self-reset promise in {@link canResetMemberPassword}'s docstring
 * (a social-sign-in user setting themselves a password) working under CAPACITYLENS_MULTI_ACCOUNT:
 * without the exemption, an owner of account X who is also a plain editor in account Y could not reset
 * their OWN password, because the loop would hit Y and `canResetMemberPassword('editor','editor')`
 * fails the `manageMembers` tier. Behaviour for the ACTING account is unchanged either way: the
 * route's `authorize(..., 'manageMembers')` gate still restricts who may call at all, and the
 * per-account matrix already passes `(admin,admin)`/`(owner,owner)` for a self-target in that account.
 *
 * PURE: no I/O — operates on the two role-by-account maps the caller reads from the membership table.
 * Fail-closed: a target with NO memberships, or ANY account where the actor lacks sufficient
 * authority (including not being a member there at all), yields `false`.
 *
 * @param actorRolesByAccount   The acting user's role in each account they belong to.
 * @param targetRolesByAccount  The target user's role in each account they belong to.
 * @param isSelf                `true` iff the actor IS the target (a self-reset); skips the
 *                              cross-account authority check per the exemption above.
 * @returns `true` iff the actor may reset the target's global credential; `false` otherwise.
 */
export function canResetMemberAcrossAccounts(
  actorRolesByAccount: ReadonlyMap<string, Role>,
  targetRolesByAccount: ReadonlyMap<string, Role>,
  isSelf: boolean,
): boolean {
  return canAdministerIdentityAcrossWorkspaces(
    actorRolesByAccount,
    targetRolesByAccount,
    isSelf,
  )
}

/**
 * Field-level visibility rule: only an owner or admin may see a time-off entry's `note`.
 *
 * Kept SEPARATE from the {@link Action} matrix on purpose — this is a *field-visibility* rule
 * (which columns to project), not a *route action* (whether to allow a request). The server
 * enforces it by redacting `note` from the read slice for everyone below admin; the client
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

/**
 * Field-level visibility rule for private client/project real names and their stored code-name
 * settings. This is intentionally stricter than time-off notes: the account owner is the sole role
 * that receives the real name; admins, editors and viewers receive the quoted code-name projection.
 */
export function canSeePrivateNames(role: Role): boolean {
  return role === 'owner'
}
