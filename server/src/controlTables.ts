import type { Role } from '@capacitylens/shared/domain/access'
import type { Db } from './db'

// Server-CONTROL tables — the user↔account binding (membership + its roles) AND the single-use
// invite links that mint such memberships (P1.9). These mirror Better Auth's own user/session/
// account tables (see auth.ts): they live in the same SQLite file but are DELIBERATELY OUTSIDE the
// AppData drift path. BOTH `account_members` AND `invites` are intentionally absent from shared
// AppData / SCOPED_KEYS, tables.ts TABLES / CREATE_ORDER / SCOPED_ORDER, KNOWN_KEYS, the seed
// fixtures, sanitizeImportedRecord, loadState, the generic /api/:entity CRUD, and import/export. They
// are reached ONLY through the helpers below, which permissioned endpoints (P1.2 / P1.5 / P1.9) wrap
// — never through the entity machinery. Keeping them off that path is the whole point: if either were
// AppData it would leak through generic CRUD and the state read/export (an invite leak would hand out
// a live, role-bearing token).

/**
 * The lifecycle status of one membership row.
 *
 * Forward-compatible enum: only `'active'` exists today (a row IS an active membership). Future
 * statuses — e.g. `'invited'` (email-preauthorised, not yet bound) or `'suspended'` — may be added
 * here as the invite/lifecycle work (P1.9/P1.10) lands; modelling it as a named union now means
 * those additions are a one-line widening rather than a column-meaning change.
 */
export type MembershipStatus = 'active'

/**
 * One row of the `account_members` control table: a single login's role for a single account.
 *
 * @property accountId  The account this membership grants access to.
 * @property userId     The login (auth-provider user id) that holds the role.
 * @property role       The account-wide {@link Role} (see shared/domain/access for the semantics).
 * @property status     The membership {@link MembershipStatus} (`'active'` today).
 * @property createdAt  ISO-8601 timestamp the membership was created.
 *
 * INVARIANT: `(accountId, userId)` is unique — a login has at most one role per account. This is a
 * CONTROL-table type, never an AppData entity; it never flows through the entity drift path.
 */
export interface AccountMember {
  accountId: string
  userId: string
  role: Role
  status: MembershipStatus
  createdAt: string
}

/** The role values accepted on write. Single source for the runtime guard below; mirrors the pure
 *  `Role` union in shared (kept in lock-step — adding a role there means adding it here). */
const KNOWN_ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'viewer']

const isKnownRole = (value: unknown): value is Role =>
  typeof value === 'string' && (KNOWN_ROLES as readonly string[]).includes(value)

/**
 * Create the membership control table (and its lookup indexes) if absent. IDEMPOTENT — every
 * statement is `IF NOT EXISTS`, so this is safe to run on EVERY boot and on every opened DB
 * (including the `:memory:` databases tests open via openDb).
 *
 * Schema: `account_members(accountId, userId, role, status, createdAt)` with a composite
 * PRIMARY KEY `(accountId, userId)` (a login has at most one role per account), plus a
 * by-`userId` index (P1.2's listAccounts: "which accounts can this login see?") and a
 * by-`accountId` index (member-management listing: "who is in this account?").
 *
 * Also creates `invites(token PK, accountId, role, preauthEmail?, expiresAt, usedAt?, createdAt)`
 * (P1.9) — the single-use, expiring invite links that mint a membership on accept — with a
 * by-`accountId` index (list an account's outstanding invites).
 *
 * No FOREIGN KEY to `accounts(id)` on EITHER table BY DESIGN: these are control-plane tables that
 * must stay decoupled from the AppData cascade — they must never be dragged into the entity drift
 * path, and membership/invites are managed by dedicated permissioned endpoints, not by the AppData
 * delete cascade. They therefore carry no FK, so the caller's `PRAGMA foreign_keys` state is
 * irrelevant to them.
 *
 * @param db  The open SQLite handle.
 */
export function ensureControlTables(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_members (
      accountId TEXT NOT NULL,
      userId TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (accountId, userId)
    );
    CREATE INDEX IF NOT EXISTS idx_account_members_userId ON account_members(userId);
    CREATE INDEX IF NOT EXISTS idx_account_members_accountId ON account_members(accountId);
    CREATE TABLE IF NOT EXISTS invites (
      token TEXT NOT NULL PRIMARY KEY,
      accountId TEXT NOT NULL,
      role TEXT NOT NULL,
      preauthEmail TEXT,            -- NULLABLE; P1.10 (email-preauth) uses it; P1.9 always writes NULL
      expiresAt TEXT NOT NULL,
      usedAt TEXT,                  -- NULL = unused; set once on accept (single-use)
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invites_accountId ON invites(accountId);
  `)
}

/**
 * Insert a membership, or update the role/status/createdAt of an existing `(accountId, userId)`.
 * The idempotent write the permissioned member-management endpoints (P1.5) use: re-inviting an
 * existing member just changes their role rather than erroring on the PK conflict.
 *
 * @param db      The open SQLite handle.
 * @param member  The membership to upsert.
 * @throws Error  If `member.role` is not a known {@link Role}. A bad role is a programming/integrity
 *   fault, not a recoverable request condition — fail LOUD (mirroring the store's deliberate
 *   integrity throws) rather than silently coercing it to a default, which would hand someone the
 *   wrong access level.
 */
export function upsertMember(db: Db, member: AccountMember): void {
  if (!isKnownRole(member.role)) {
    throw new Error(
      `upsertMember: unknown role ${JSON.stringify(member.role)} — expected one of ${KNOWN_ROLES.join(', ')}.`,
    )
  }
  db.prepare(
    `INSERT INTO account_members (accountId, userId, role, status, createdAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(accountId, userId) DO UPDATE SET
       role = excluded.role, status = excluded.status, createdAt = excluded.createdAt`,
  ).run(member.accountId, member.userId, member.role, member.status, member.createdAt)
}

/**
 * Resolve one login's role for one account, or `null` if it is not a member. The primitive P1.2's
 * `resolveRole` wraps; permissioned routes call that to drive the pure `can(role, action)` check.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account to look up.
 * @param userId     The login to look up.
 * @returns The {@link Role}, or `null` when no `(accountId, userId)` membership exists.
 */
export function getMemberRole(db: Db, accountId: string, userId: string): Role | null {
  const row = db
    .prepare(`SELECT role FROM account_members WHERE accountId = ? AND userId = ?`)
    .get(accountId, userId) as { role?: string } | undefined
  return isKnownRole(row?.role) ? row.role : null
}

/**
 * List every membership a login holds, across all accounts — the by-`userId` lookup P1.2's
 * `listAccounts` builds on (it is what answers "which accounts may this login see?").
 *
 * @param db      The open SQLite handle.
 * @param userId  The login whose memberships to list.
 * @returns That login's membership rows (possibly empty); never another login's rows.
 */
export function listMembershipsForUser(db: Db, userId: string): AccountMember[] {
  const rows = db
    .prepare(
      `SELECT accountId, userId, role, status, createdAt FROM account_members WHERE userId = ?`,
    )
    .all(userId) as Array<{
    accountId: string
    userId: string
    role: string
    status: string
    createdAt: string
  }>
  // Map rows explicitly (mirrors rowCodec's row→object discipline) so the returned objects carry
  // the precise Role/MembershipStatus unions, not the raw TEXT columns. A row whose role is somehow
  // not a known Role is a control-table integrity fault (every write goes through upsertMember's
  // guard) — fail LOUD rather than hand back a mistyped role.
  return rows.map((r) => {
    if (!isKnownRole(r.role)) {
      throw new Error(
        `listMembershipsForUser: stored role ${JSON.stringify(r.role)} for (${r.accountId}, ${r.userId}) is not a known role — control table corrupted.`,
      )
    }
    return {
      accountId: r.accountId,
      userId: r.userId,
      role: r.role,
      status: r.status as MembershipStatus,
      createdAt: r.createdAt,
    }
  })
}

/**
 * One row of the `invites` control table (P1.9): a single-use, expiring link that, when accepted by
 * a signed-in caller, binds {@link role} to that caller's membership of {@link accountId}.
 *
 * @property token         The opaque, unguessable invite secret — the link's `:token` segment AND
 *   the table's PRIMARY KEY. Treat it like a password: never log it.
 * @property accountId     The account a successful accept joins the caller to.
 * @property role          The {@link Role} the accept binds (see shared/domain/access for semantics).
 * @property preauthEmail  An OPTIONAL pre-authorised email. `null` in P1.9 (any signed-in caller may
 *   accept); P1.10 will require the caller's verified email to match this when non-null.
 * @property expiresAt     ISO-8601 instant after which the invite is rejected (410).
 * @property usedAt        ISO-8601 instant the invite was consumed, or `null` while unused. A
 *   non-null value is the single-use marker — a second accept is rejected (409).
 * @property createdAt     ISO-8601 timestamp the invite was minted.
 *
 * This is a CONTROL-table type, never an AppData entity; it never flows through the entity drift path.
 */
export interface Invite {
  token: string
  accountId: string
  role: Role
  preauthEmail: string | null
  expiresAt: string
  usedAt: string | null
  createdAt: string
}

/**
 * Persist a new invite. The write the create endpoint (POST /api/invites) uses after generating the
 * token + computing the TTL.
 *
 * @param db      The open SQLite handle.
 * @param invite  The invite to insert (token is its PRIMARY KEY).
 * @throws Error  If `invite.role` is not a known {@link Role} — a bad role is a programming/integrity
 *   fault, not a recoverable request condition, so fail LOUD (mirrors {@link upsertMember}) rather
 *   than silently coercing it and minting an invite that grants the wrong access level.
 */
export function createInvite(db: Db, invite: Invite): void {
  if (!isKnownRole(invite.role)) {
    throw new Error(
      `createInvite: unknown role ${JSON.stringify(invite.role)} — expected one of ${KNOWN_ROLES.join(', ')}.`,
    )
  }
  db.prepare(
    `INSERT INTO invites (token, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    invite.token,
    invite.accountId,
    invite.role,
    invite.preauthEmail,
    invite.expiresAt,
    invite.usedAt,
    invite.createdAt,
  )
}

/**
 * Resolve one invite by its token, or `null` if no such token exists. The lookup the accept endpoint
 * (POST /api/invites/:token/accept) uses before validating used/expired and binding the membership.
 *
 * @param db     The open SQLite handle.
 * @param token  The invite token (the link's `:token` segment).
 * @returns The {@link Invite}, or `null` when no row has that token.
 */
export function getInvite(db: Db, token: string): Invite | null {
  const row = db
    .prepare(
      `SELECT token, accountId, role, preauthEmail, expiresAt, usedAt, createdAt FROM invites WHERE token = ?`,
    )
    .get(token) as
    | {
        token: string
        accountId: string
        role: string
        preauthEmail: string | null
        expiresAt: string
        usedAt: string | null
        createdAt: string
      }
    | undefined
  if (!row) return null
  // Map the row explicitly (mirrors upsertMember/listMembershipsForUser's row→object discipline) so
  // the returned object carries the precise Role union, not the raw TEXT column. A stored role that
  // is not a known Role is a control-table integrity fault (every write goes through createInvite's
  // guard) — fail LOUD rather than hand back a mistyped, access-granting role.
  if (!isKnownRole(row.role)) {
    throw new Error(
      `getInvite: stored role ${JSON.stringify(row.role)} for token is not a known role — control table corrupted.`,
    )
  }
  return {
    token: row.token,
    accountId: row.accountId,
    role: row.role,
    // Coerce SQLite's nullable cols to a real `null` (node:sqlite yields null already, but pin the
    // contract so the type is honest and a future driver change can't leak `undefined`).
    preauthEmail: row.preauthEmail ?? null,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt ?? null,
    createdAt: row.createdAt,
  }
}

/**
 * Normalize an email for preauth comparison: trim + lowercase. Both the stored `preauthEmail`
 * (normalized once at create time) and the caller's verified email (normalized at accept time) pass
 * through this, so the match is always normalized-vs-normalized — case and surrounding whitespace
 * never cause a legitimate match to slip through (or, worse, a near-miss to bind the wrong account).
 *
 * Pure: no I/O. Deliberately NOT a full RFC validator — local-parts are case-sensitive in the
 * abstract, but in practice every mail provider folds them, and the IdP-returned verified address is
 * the trust anchor here, so casefolding is the right comparison for binding.
 *
 * @param email  The raw email (from a request body, or from an IdP-asserted session user).
 * @returns The trimmed, lowercased form used for storage and comparison.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * May this signed-in principal accept this invite? The PURE security-matrix decision behind the
 * accept endpoint's email-preauth gate (P1.10) — extracted so the matrix is deterministically
 * unit-testable without spinning up a session/DB.
 *
 * - `preauthEmail === null` → `true` (a LINK invite: any signed-in caller may accept — P1.9
 *   behaviour, preserved).
 * - `preauthEmail !== null` → `true` ONLY iff BOTH hold:
 *     1. `user.emailVerified === true` — an unverified (or unverifiable-provider) principal NEVER
 *        binds a preauth invite (Decision: providers that omit verification ⇒ treat as unverified).
 *     2. `normalizeEmail(user.email) === preauthEmail` — the stored `preauthEmail` is ALREADY
 *        normalized (at create time), so this compares normalized-vs-normalized.
 *
 * Pure: no I/O, no session lookup — the caller passes the already-resolved principal. A `false`
 * result MUST translate to a 403 that binds nothing and consumes nothing (the invite stays live for
 * the genuinely-matching caller). Nothing is ever emailed.
 *
 * @param preauthEmail  The invite's pre-authorised email (already normalized), or `null` for a link
 *   invite.
 * @param user          The resolved signed-in principal — its IdP-asserted `email` and the
 *   load-bearing `emailVerified` flag.
 * @returns `true` if this principal may accept this invite, `false` otherwise.
 */
export function preauthInviteAllows(
  preauthEmail: string | null,
  user: { email: string; emailVerified: boolean },
): boolean {
  if (preauthEmail === null) return true // link invite: any signed-in caller (P1.9)
  // Email-preauth invite: bind ONLY for a VERIFIED principal whose verified email matches exactly.
  // Both sides are normalized (preauthEmail at create, user.email here), so the compare is exact.
  return user.emailVerified === true && normalizeEmail(user.email) === preauthEmail
}

/**
 * A light, deterministic email-shape check for the create endpoint — a single `@` separating a
 * non-empty local part from a non-empty domain. DELIBERATELY not a full RFC 5322 validator: its only
 * job is to reject obvious junk (no `@`, empty side, multiple `@`) before storing a preauth email, so
 * a malformed value can't mint an invite that could never bind. The trust anchor for the actual
 * binding is the IdP-asserted verified email at accept time, not this check.
 *
 * @param email  The (already trimmed) candidate email.
 * @returns `true` if it has a single `@` with non-empty local + domain parts.
 */
export function looksLikeEmail(email: string): boolean {
  const at = email.indexOf('@')
  // Exactly one '@', and it is neither the first nor the last character.
  return at > 0 && at === email.lastIndexOf('@') && at < email.length - 1
}

/**
 * Mark an invite consumed — the single-use stamp the accept endpoint runs (in the SAME transaction
 * as the membership it mints, so the bind and the consume commit together or not at all).
 *
 * The `AND usedAt IS NULL` clause is the single-use SQL BACKSTOP: even if two accepts race past the
 * handler's `usedAt !== null` check, only the first UPDATE matches an unused row, so the token can be
 * consumed at most once. (The handler's check is the friendly 409; this is the hard guarantee.)
 *
 * @param db      The open SQLite handle.
 * @param token   The invite token to consume.
 * @param usedAt  The ISO-8601 instant to stamp as the consumption time.
 */
export function markInviteUsed(db: Db, token: string, usedAt: string): void {
  db.prepare(`UPDATE invites SET usedAt = ? WHERE token = ? AND usedAt IS NULL`).run(usedAt, token)
}
