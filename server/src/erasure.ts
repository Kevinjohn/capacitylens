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
// called ONLY from the two `'purge'`-gated delete vectors (DELETE /api/accounts/:id and the batch
// `accounts`/DELETE op in app.ts), NEVER from /api/:entity, loadState, import, export or any read path.
//
// WHY this exists: the AppData delete-cascade (FK ON DELETE CASCADE off `accounts`) wipes the account's
// SCOPED tables, but THREE PII surfaces have no FK to `accounts` and so survive a bare `deleteRow`:
//   1. `account_members` + `invites` — the control tables (deliberately decoupled, see controlTables.ts).
//   2. Better Auth's `user` table — the member's name + email (+ profile image).
//   3. Better Auth's `account`/`session` tables — the member's SSO/credential link + live sessions.
// This module closes all three.
//
// BETTER AUTH SCHEMA PIN (verified 2026-06-26 against better-auth 1.6.20, the version in package.json):
//   user(id PK, name NOT NULL, email NOT NULL+UNIQUE, emailVerified, image NULLABLE, createdAt, updatedAt)
//   account(id PK, …, userId NOT NULL, …)   — the SSO/credential link rows
//   session(id PK, …, userId NOT NULL)       — the live session rows
// We scrub `user.name`/`user.email`/`user.image` and DELETE the `account`.userId / `session`.userId
// rows. If a future Better Auth version renames/drops any of these columns, the erasure tests
// (app.erasure.test.ts) fail LOUD on the changed schema rather than silently leaking PII — that is the
// whole point of pinning the columns here AND asserting them there.

/** The NOT-NULL replacement written over an erased member's `user.name`. `user.name` is NOT NULL, so
 *  the scrub cannot blank it — it must read clearly as a removed identity. */
const ERASED_NAME = 'Removed member'

/**
 * Derive the GLOBALLY-UNIQUE scrubbed email for an erased user from the FULL userId — strip every
 * non-alphanumeric character (so a UUID's hyphens go) and embed the result, yielding
 * `deleted-<sanitised-userId>@invalid`. PURE: a function of the id string only.
 *
 * WHY the full id, not a short slice: `user.email` is NOT NULL **and UNIQUE** (sqlite_autoindex_user_2),
 * so two erased users MUST NOT collide on it — a 4-char tag (the {@link obfuscateResource} idiom for the
 * non-unique resource `name`) would clash and the second scrub would throw a UNIQUE violation. Using the
 * full sanitised id guarantees distinct emails for distinct users. The `@invalid` TLD is RFC-2606
 * reserved and non-routable, so a scrubbed address can never reach a real mailbox.
 *
 * INJECTIVITY rests on Better Auth ids being alphanumeric (or fixed-position-hyphen UUIDs), so
 * stripping non-alphanumerics never maps two distinct ids to the same string — verified against the
 * 1.6.20 id generator. RESIDUAL EDGE (fails CLOSED, no PII leak): a real user who had signed up with
 * the literal address `deleted-<thatExactId>@invalid` would collide on the UNIQUE index and the scrub
 * would throw → the whole erasure rolls back and the delete fails loudly. That requires pre-guessing an
 * unguessable future userId, so it is a non-practical self-DoS, never a leak — acceptable per
 * simplicity-first; harden only if account ids ever become guessable.
 */
function erasedEmailFor(userId: string): string {
  return `deleted-${userId.replace(/[^a-zA-Z0-9]/g, '')}@invalid`
}

/**
 * Does the Better Auth `user` table exist on this handle? In OFF / auth-off mode the auth migrations
 * never run, so `user`/`account`/`session` are ABSENT — the per-user PII scrub must be skipped cleanly
 * rather than throw `no such table: user`. (In OFF mode `account_members` is also empty, so there are
 * no member ids to scrub anyway; this guard is what makes an OFF-mode account delete safe.)
 *
 * Checks `sqlite_master` for the `user` table specifically: the three auth tables are always created
 * together by one `runAuthMigrations`, so the presence of `user` is a sound proxy for all three.
 */
function authTablesPresent(db: Db): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`)
    .get() as { name?: string } | undefined
  return row?.name === 'user'
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
 *  4. Per-user PII scrub, guarded by {@link authTablesPresent} (skipped entirely in OFF/auth-off mode,
 *     where the auth tables don't exist and `memberIds` is `[]` anyway). For EACH captured user, the
 *     MULTI-ACCOUNT RETENTION rule: after step 3 their membership of THIS account is gone, so
 *     `listMembershipsForUser` now returns only OTHER accounts' memberships. A user still in another
 *     account is NOT scrubbed (they remain an active member elsewhere); only a user with ZERO remaining
 *     memberships is erased — name/email/image scrubbed on `user`, and their `account` (SSO/credential
 *     link) + `session` (live logins) rows deleted so a scrubbed identity cannot stay linked or signed in.
 *
 * SURFACE-NOT-SWALLOW: this opens no try/catch — every step's throw (a UNIQUE clash, a missing table,
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

  // (4) Per-user PII scrub. Skip cleanly when the Better Auth tables are absent (OFF/auth-off) — there
  // memberIds is [] and `user`/`account`/`session` don't exist, so this never throws "no such table".
  if (!authTablesPresent(db)) return
  const scrubName = db.prepare(`UPDATE user SET name = ?, email = ?, image = NULL WHERE id = ?`)
  const unlinkAccount = db.prepare(`DELETE FROM account WHERE userId = ?`)
  const killSessions = db.prepare(`DELETE FROM session WHERE userId = ?`)
  for (const userId of memberIds) {
    // MULTI-ACCOUNT RETENTION: step 3 already removed THIS account's membership, so what remains is the
    // user's memberships of OTHER accounts. A user still in another account stays a real, active member
    // there — DO NOT scrub them. Only erase a user whose last membership was the one we just removed.
    if (listMembershipsForUser(db, userId).length > 0) continue
    // Sole-member-of-the-erased-tenant: scrub identity + unlink credentials + kill sessions. Parameterised
    // exactly like getUsersByIds/removeMember (no string interpolation of ids).
    scrubName.run(ERASED_NAME, erasedEmailFor(userId), userId)
    unlinkAccount.run(userId)
    killSessions.run(userId)
  }
}

/**
 * Erase one account and all its PII inside a fresh transaction — the standalone transactional entry
 * point. Wraps {@link eraseAccountInTx} in `tx`, so the whole erasure is all-or-nothing: any throw mid-way
 * (a UNIQUE clash, a missing table) rolls the transaction back, leaving the tenant fully intact.
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
