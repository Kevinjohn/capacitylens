import type { Db } from './db'
import { deleteRow, getRow } from './db'
import { tx } from './txn'
import {
  erasePrincipalCommandHistoryInTx,
  removePrincipalSessionAssurance,
  removeSecurityRevision,
} from './accounts/state'
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
// BETTER AUTH SCHEMA PIN (reverified 2026-07-18 against better-auth 1.6.23, the version in package.json):
//   user(id PK, name NOT NULL, email NOT NULL+UNIQUE, emailVerified, image NULLABLE, createdAt, updatedAt)
//   account(id PK, …, userId NOT NULL, …)   — the SSO/credential link rows
//   session(id PK, …, userId NOT NULL)       — the live session rows
//   verification(id PK, identifier, value, …) — reset tokens store userId directly in `value`;
//     database-backed OAuth account-link state stores JSON with the userId at `link.userId`
//   twoFactor(id PK, userId, secret, backupCodes, …) — TOTP and recovery material
// We DELETE all five identity surfaces for a user who loses their last membership. Deleting the
// `user` row, rather than retaining a scrubbed shell, is also load-bearing for password-mode
// recovery: setup-token-guarded first-run signup and bootstrap reopen only when the user table is
// empty. If a future
// Better Auth version renames/drops any of these columns, the erasure tests
// (app.erasure.test.ts) fail LOUD on the changed schema rather than silently leaking PII — that is the
// whole point of pinning the columns here AND asserting them there.

/**
 * Does the Better Auth `user` table exist on this handle? In OFF / auth-off mode the auth migrations
 * never run, so the auth tables are ABSENT — the per-user identity deletion must be skipped cleanly
 * rather than throw `no such table: user`. (In OFF mode `account_members` is also empty, so there are
 * no member ids to erase anyway; this guard is what makes an OFF-mode account delete safe.)
 *
 * Checks `sqlite_master` for the `user` table specifically. Production auth migrations create the
 * core identity tables together; targeted conformance fixtures may omit tables whose behavior they
 * do not exercise.
 */
function authTablesPresent(db: Db): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`)
    .get() as { name?: string } | undefined
  return row?.name === 'user'
}

function authTablePresent(db: Db, table: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined
}

/**
 * Extract the user id from Better Auth's database-backed OAuth account-link state. Ordinary OAuth
 * sign-in states have no `link`; account-link states store a JSON object containing
 * `{ link: { email, userId }, ... }` in `verification.value` (better-auth 1.6.23, state.mjs).
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
 *     `listMembershipsForUser` now returns only OTHER accounts' memberships. A user is retained only
 *     when at least one of those rows is active and points at a live account. Inactive or dangling
 *     control rows confer no access and must not indefinitely retain identity PII. Every other user is
 *     erased — reset tokens, live sessions, credential links, and finally the user row itself are
 *     deleted. Removing that final row reopens password-mode first-run recovery when this was the last
 *     company and user.
 *
 * SURFACE-NOT-SWALLOW: this opens no try/catch — every step's throw (a missing table,
 * an FK error) propagates to the enclosing `tx`, which ROLLS BACK and rethrows. A partial erasure must
 * never commit (fail-closed): either every trace of the tenant is gone, or nothing changed.
 *
 * @param db         The open SQLite handle (already inside a transaction).
 * @param accountId  The account to erase.
 */
export function eraseWorkspaceDataAndMembershipsInTx(db: Db, accountId: string): string[] {
  // (1) Capture member user ids BEFORE any delete — the membership rows vanish in step 3.
  const memberIds = listMembersForAccount(db, accountId).map((m) => m.userId)

  // (2) Drop the account row — FK ON DELETE CASCADE wipes THIS account's scoped AppData (only this one).
  deleteRow(db, 'accounts', accountId)

  // (3) Sweep the control tables (no FK to accounts → not reached by the cascade above).
  removeAllMembersForAccount(db, accountId)
  removeAllInvitesForAccount(db, accountId)

  // (4) Per-user identity deletion. Skip cleanly when the Better Auth tables are absent (OFF/auth-off) — there
  // memberIds is [] and `user`/`account`/`session` don't exist, so this never throws "no such table".
  if (!authTablesPresent(db)) return []
  const hasLiveMembership = (userId: string): boolean =>
    listMembershipsForUser(db, userId).some(
      (membership) => membership.status === 'active' && getRow(db, 'accounts', membership.accountId) !== undefined,
    )
  const erasedUserIds = new Set(memberIds.filter((userId) => !hasLiveMembership(userId)))
  return [...erasedUserIds]
}

/** Delete one installation-local identity and its local provider/session state inside an existing
 * SQLite transaction. This never calls an upstream provider API and never deletes an upstream IdP
 * subject; only this installation's Better Auth rows are in scope. */
export function eraseLocalPrincipalInTx(db: Db, userId: string): void {
  if (!authTablesPresent(db)) return

  // Assurance handles are deliberately not bearer tokens, but they are still principal-owned
  // security state. Delete them by their explicit ownership key before removing provider sessions.
  removePrincipalSessionAssurance(db, userId)

  // Verification rows have no userId column. Password-reset rows carry the bare id in `value`, while
  // database-backed OAuth account-link states encode it inside JSON at `link.userId`. Scan once and
  // delete by primary key so unrelated OAuth states, OTPs and malformed rows remain untouched.
  const verificationRows = db.prepare(`SELECT id, value FROM verification`).all() as Array<{ id: string; value: string }>
  const revokeVerification = db.prepare(`DELETE FROM verification WHERE id = ?`)
  for (const row of verificationRows) {
    const linkedUserId = accountLinkUserId(row.value)
    if (row.value === userId || linkedUserId === userId) {
      revokeVerification.run(row.id)
    }
  }

  const killSessions = db.prepare(`DELETE FROM session WHERE userId = ?`)
  const unlinkAccount = db.prepare(`DELETE FROM account WHERE userId = ?`)
  const deleteUser = db.prepare(`DELETE FROM user WHERE id = ?`)
  killSessions.run(userId)
  unlinkAccount.run(userId)
  // Password profiles install Better Auth's two-factor plugin table outside the four core auth
  // tables. It contains the TOTP secret, encrypted recovery codes and lockout state, so erase it
  // explicitly rather than relying on a library-owned foreign-key action that may change on upgrade.
  if (authTablePresent(db, 'twoFactor')) {
    db.prepare(`DELETE FROM twoFactor WHERE userId = ?`).run(userId)
  }
  deleteUser.run(userId)
  removeSecurityRevision(db, userId)
}

export function eraseAccountInTx(db: Db, accountId: string): void {
  const orphanedPrincipalIds = eraseWorkspaceDataAndMembershipsInTx(db, accountId)
  for (const principalId of orphanedPrincipalIds) {
    erasePrincipalCommandHistoryInTx(db, principalId)
    eraseLocalPrincipalInTx(db, principalId)
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
