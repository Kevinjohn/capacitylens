import type { Db } from './db'
import { deleteRow } from './db'
import { tx } from './txn'
import {
  listMembersForAccount,
  listMembershipsForUser,
  removeAllInvitesForAccount,
  removeAllMembersForAccount,
} from './controlTables'

// Per-tenant DELETE + member-PII erasure (P2.6b). A hard account-delete must leave NO PII anywhere —
// not in AppData, not in the control tables, and not in Better Auth's own identity tables. This module
// is that erasure, and the SINGLE place it lives. It is the dedicated, permissioned server path: it is
// called ONLY from the two `'deleteAccount'`-gated delete vectors (DELETE /api/accounts/:id and the batch
// `accounts`/DELETE op in app.ts), NEVER from /api/:entity, loadState, import, export or any read path.
//
// WHY this exists: the AppData delete-cascade (FK ON DELETE CASCADE off `accounts`) wipes the account's
// SCOPED tables, but THREE PII surfaces have no FK to `accounts` and so survive a bare `deleteRow`:
//   1. `account_members` + `invites` — the control tables (deliberately decoupled, see controlTables.ts).
//   2. Better Auth's `user` table — the member's name + email (+ profile image).
//   3. Better Auth's `account`/`session`/`verification` tables — credential links, live sessions,
//      and outstanding password-reset tokens.
// This module closes all three.
//
// BETTER AUTH SCHEMA PIN (verified 2026-06-26 against better-auth 1.6.20, the version in package.json):
//   user(id PK, name NOT NULL, email NOT NULL+UNIQUE, emailVerified, image NULLABLE, createdAt, updatedAt)
//   account(id PK, …, userId NOT NULL, …)   — the SSO/credential link rows
//   session(id PK, …, userId NOT NULL)       — the live session rows
//   verification(id PK, identifier, value, …) — reset tokens store userId directly in `value`;
//     database-backed OAuth account-link state stores JSON with the userId at `link.userId`
// We DELETE all four identity surfaces for a user who loses their last membership. Deleting the
// `user` row, rather than retaining a scrubbed shell, is also load-bearing for password-mode
// recovery: first-run signup and bootstrap reopen only when the user table is empty. If a future
// Better Auth version renames/drops any of these columns, the erasure tests
// (app.erasure.test.ts) fail LOUD on the changed schema rather than silently leaking PII — that is the
// whole point of pinning the columns here AND asserting them there.

/**
 * Does the Better Auth `user` table exist on this handle? In OFF / auth-off mode the auth migrations
 * never run, so the auth tables are ABSENT — the per-user identity deletion must be skipped cleanly
 * rather than throw `no such table: user`. (In OFF mode `account_members` is also empty, so there are
 * no member ids to erase anyway; this guard is what makes an OFF-mode account delete safe.)
 *
 * Checks `sqlite_master` for the `user` table specifically: the four auth tables are always created
 * together by one `runAuthMigrations`, so the presence of `user` is a sound proxy for all four.
 */
function authTablesPresent(db: Db): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`)
    .get() as { name?: string } | undefined
  return row?.name === 'user'
}

/**
 * Extract the user id from Better Auth's database-backed OAuth account-link state. Ordinary OAuth
 * sign-in states have no `link`; account-link states store a JSON object containing
 * `{ link: { email, userId }, ... }` in `verification.value` (better-auth 1.6.20, state.mjs).
 *
 * Malformed and unrelated values are intentionally ignored. Password-reset rows are handled by the
 * separate exact `value === userId` check because their value is the bare user id, not JSON.
 */
function accountLinkUserId(value: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const link = (parsed as { link?: unknown }).link
  if (typeof link !== 'object' || link === null) return null
  const userId = (link as { userId?: unknown }).userId
  if (typeof userId === 'string') return userId
  // Better Auth coerces the field to a string when reading it; accept a legacy numeric encoding too.
  return typeof userId === 'number' && Number.isFinite(userId) ? String(userId) : null
}

/**
 * Erase one account and every trace of PII it owns — the erasure BODY. ASSUMES it runs INSIDE an
 * existing transaction (it does NOT open its own `tx`); use {@link eraseAccount} for the standalone
 * transactional entry point, or call this directly from a path that already holds a transaction (the
 * batch in app.ts). node:sqlite has no nested BEGIN, so a path already inside `tx()` MUST use this.
 *
 * Steps, IN ORDER (the ordering is load-bearing):
 *  1. Capture the account's member user ids BEFORE any delete — once step 3 drops the membership rows
 *     they are unrecoverable, so the per-user scrub set must be taken first.
 *  2. `deleteRow('accounts', accountId)` — the FK ON DELETE CASCADE wipes THIS account's scoped AppData
 *     (and only this account's; every scoped FK is to this `accounts.id`).
 *  3. Remove this account's `account_members` then `invites` rows — the control tables have NO FK to
 *     `accounts`, so the cascade never reached them; without this they LEAK after the account is gone.
 *  4. Per-user identity deletion, guarded by {@link authTablesPresent} (skipped entirely in OFF/auth-off mode,
 *     where the auth tables don't exist and `memberIds` is `[]` anyway). For EACH captured user, the
 *     MULTI-ACCOUNT RETENTION rule: after step 3 their membership of THIS account is gone, so
 *     `listMembershipsForUser` now returns only OTHER accounts' memberships. A user still in another
 *     account is retained unchanged (they remain an active member elsewhere); only a user with ZERO
 *     remaining memberships is erased — reset tokens, live sessions, credential links, and finally the
 *     user row itself are deleted. Removing that final row reopens password-mode first-run recovery when
 *     this was the last company and user.
 *
 * SURFACE-NOT-SWALLOW: this opens no try/catch — every step's throw (a missing table,
 * an FK error) propagates to the enclosing `tx`, which ROLLS BACK and rethrows. A partial erasure must
 * never commit (fail-closed): either every trace of the tenant is gone, or nothing changed.
 *
 * @param db         The open SQLite handle (already inside a transaction).
 * @param accountId  The account to erase.
 */
export function eraseAccountInTx(db: Db, accountId: string): void {
  // (1) Capture member user ids BEFORE any delete — the membership rows vanish in step 3.
  const memberIds = listMembersForAccount(db, accountId).map((m) => m.userId)

  // (2) Drop the account row — FK ON DELETE CASCADE wipes THIS account's scoped AppData (only this one).
  deleteRow(db, 'accounts', accountId)

  // (3) Sweep the control tables (no FK to accounts → not reached by the cascade above).
  removeAllMembersForAccount(db, accountId)
  removeAllInvitesForAccount(db, accountId)

  // (4) Per-user identity deletion. Skip cleanly when the Better Auth tables are absent (OFF/auth-off) — there
  // memberIds is [] and `user`/`account`/`session` don't exist, so this never throws "no such table".
  if (!authTablesPresent(db)) return
  const erasedUserIds = new Set(memberIds.filter((userId) => listMembershipsForUser(db, userId).length === 0))
  if (erasedUserIds.size === 0) return

  // Verification rows have no userId column. Password-reset rows carry the bare id in `value`, while
  // database-backed OAuth account-link states encode it inside JSON at `link.userId`. Scan once and
  // delete by primary key so unrelated OAuth states, OTPs and malformed rows remain untouched.
  const verificationRows = db.prepare(`SELECT id, value FROM verification`).all() as Array<{ id: string; value: string }>
  const revokeVerification = db.prepare(`DELETE FROM verification WHERE id = ?`)
  for (const row of verificationRows) {
    const linkedUserId = accountLinkUserId(row.value)
    if (erasedUserIds.has(row.value) || (linkedUserId !== null && erasedUserIds.has(linkedUserId))) {
      revokeVerification.run(row.id)
    }
  }

  const killSessions = db.prepare(`DELETE FROM session WHERE userId = ?`)
  const unlinkAccount = db.prepare(`DELETE FROM account WHERE userId = ?`)
  const deleteUser = db.prepare(`DELETE FROM user WHERE id = ?`)
  for (const userId of erasedUserIds) {
    // Sole-member-of-the-erased-tenant: all user-bound verifications were revoked above. Kill sessions,
    // unlink credentials, then remove the identity row. This order mirrors Better Auth's own deleteUser
    // dependency order; all statements are parameterised (no string interpolation of ids).
    killSessions.run(userId)
    unlinkAccount.run(userId)
    deleteUser.run(userId)
  }
}

/**
 * Erase one account and all its PII inside a fresh transaction — the standalone transactional entry
 * point. Wraps {@link eraseAccountInTx} in `tx`, so the whole erasure is all-or-nothing: any throw mid-way
 * (a missing table or constraint error) rolls the transaction back, leaving the tenant fully intact.
 *
 * Use this from a path that is NOT already in a transaction (the direct DELETE /api/accounts/:id route).
 * A path already inside `tx()` (the /api/batch loop) MUST call {@link eraseAccountInTx} instead — node:sqlite
 * has no nested BEGIN, so wrapping again would throw.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account to erase.
 */
export function eraseAccount(db: Db, accountId: string): void {
  tx(db, () => eraseAccountInTx(db, accountId))
}
