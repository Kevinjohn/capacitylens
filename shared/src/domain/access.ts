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
