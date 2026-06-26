import type { Role } from '@capacitylens/shared/domain/access'
import type { SessionUser } from './auth'
import type { Db } from './db'
import { getRow } from './db'
import { listMembershipsForUser } from './controlTables'

// The tenancy seam: the login→account lock. Given a verified session principal, answer two
// questions and ONLY these two — "which accounts may this login see?" (listAccounts) and "what is
// this login's role for ONE account?" (resolveRole). Both are built on P1.1's `account_members`
// control-table helpers; this module adds the session-facing contract plus the ACTIVE-only filter.
//
// Server-only (I/O): these read the control table and the accounts table, so they live here, not in
// the pure shared core. The permissioned routes (P1.4 GET /api/accounts, P1.5 requirePermission)
// will wrap these — this task is the functions + unit tests only, no endpoints.
//
// ACTIVE-ONLY (carry-forward from the P1.1 review): the P1.1 helpers do NOT filter by status. For
// ACCESS purposes a non-active membership is NOT a member, so this layer keeps ONLY
// `status === 'active'` rows. The filter lives here (the access boundary), not in the P1.1
// primitives (which stay neutral row accessors).
//
// SYNCHRONOUS today: node:sqlite is synchronous and the P1.1 helpers + getRow are sync, so these
// match that idiom (simpler, no needless async). The architecture writes these as `Promise<…>`
// ASPIRATIONALLY — for a future per-agency-DB / Postgres swap behind the TenantStore seam — so a
// later async swap is anticipated; wrapping a caller in `await` over a sync return is harmless.

/** The lifecycle status that counts as a real member for ACCESS purposes. A membership whose status
 *  is anything else (a future `'invited'`/`'suspended'`) is treated as NOT a member here. */
const ACTIVE_STATUS = 'active' as const

/**
 * The minimal account summary that drives the AccountPicker (P1.13) — the login → account list.
 *
 * DELIBERATELY minimal: `id` + `name` only. This is shown to a login that may access the account, so
 * it must NOT carry sensitive or whole-account data (config, other tenants' data, member lists). If
 * the picker later needs the account colour for its swatch, P1.13 may extend this — default to the
 * smallest shape now.
 *
 * @property id    The account's id (the `accountId` a subsequent `GET /api/state?accountId=…` uses).
 * @property name  The account's company name, for display in the picker.
 */
export interface AccountSummary {
  id: string
  name: string
}

/**
 * The account summaries this login may access — the picker's data source (P1.13 / GET /api/accounts).
 *
 * Takes the login's memberships ({@link listMembershipsForUser}), keeps ONLY active ones, and maps
 * each to its account summary by reading the `accounts` table. Returns a STABLE order (by account
 * name, then id) so the picker render is deterministic.
 *
 * INVARIANTS:
 * - ACTIVE-ONLY: a non-`'active'` membership is excluded (it is not a member for access purposes).
 * - DANGLING-SKIP: a membership whose `accounts` row is MISSING is skipped, not thrown — a dangling
 *   membership (account deleted out from under the control row) must degrade to "not listed", never
 *   crash the picker. (`account_members` carries no FK to `accounts` by design — see controlTables.)
 * - TENANT ISOLATION: only the caller's own memberships are read; this never returns another login's.
 *
 * Server-only (reads two tables). Synchronous today; see the module header on the aspirational async.
 *
 * @param db       The open SQLite handle.
 * @param session  The verified session principal; `session.id` is the `userId` in `account_members`.
 * @returns The caller's active-membership account summaries, ordered by name then id (possibly empty).
 */
export function listAccounts(db: Db, session: SessionUser): AccountSummary[] {
  const summaries: AccountSummary[] = []
  for (const membership of listMembershipsForUser(db, session.id)) {
    if (membership.status !== ACTIVE_STATUS) continue
    const row = getRow(db, 'accounts', membership.accountId)
    // Dangling membership (account row gone): skip, don't throw — degrade to "not listed".
    if (!row) continue
    summaries.push({ id: String(row.id), name: String(row.name) })
  }
  // Stable order so the picker is deterministic: by name (the visible label), then id as a tiebreak.
  return summaries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/**
 * The caller's role for ONE account — the login→account lock — or `null` if they may NOT access it.
 *
 * `null` means NO ACCESS: either the login is not a member of `accountId`, OR their membership is not
 * active. The permissioned routes (P1.5) feed this role into the pure `can(role, action)` matrix; a
 * `null` here is a 403 before any data is read. Derived from the same active-membership set as
 * {@link listAccounts}, so the two can never disagree on what "a member" is.
 *
 * Server-only (reads the control table). Synchronous today; see the module header on the async swap.
 *
 * @param db         The open SQLite handle.
 * @param session    The verified session principal; `session.id` is the `userId` to look up.
 * @param accountId  The account whose role to resolve for this login.
 * @returns The {@link Role} if the login is an ACTIVE member of `accountId`, else `null` (no access).
 */
export function resolveRole(db: Db, session: SessionUser, accountId: string): Role | null {
  const membership = listMembershipsForUser(db, session.id).find(
    (m) => m.accountId === accountId && m.status === ACTIVE_STATUS,
  )
  return membership ? membership.role : null
}
