import { randomBytes } from 'node:crypto'
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
 * Also creates `invites(token PK, id, accountId, role, preauthEmail?, expiresAt, usedAt?, createdAt)`
 * (P1.9) — the single-use, expiring invite links that mint a membership on accept — with a
 * by-`accountId` index (list an account's outstanding invites). The `id` column (P1.11) is a
 * NON-SECRET handle, distinct from the bearer `token`: list/revoke key on `id` so the secret `token`
 * stays WRITE-ONCE and never travels on a read path.
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
      id TEXT NOT NULL,             -- NON-SECRET handle (P1.11); list/revoke key on this, never the token
      accountId TEXT NOT NULL,
      role TEXT NOT NULL,
      preauthEmail TEXT,            -- NULLABLE; P1.10 (email-preauth) uses it; P1.9 always writes NULL
      expiresAt TEXT NOT NULL,
      usedAt TEXT,                  -- NULL = unused; set once on accept (single-use)
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invites_accountId ON invites(accountId);
  `)
  // ADDITIVE column for an ALREADY-CREATED dev DB (the `invites` table is new in P1.9; the `id`
  // column is added in P1.11). A DB that already has the table from P1.9 won't get `id` from the
  // IF-NOT-EXISTS CREATE above (node:sqlite never re-runs CREATE on an existing table), so add it
  // here — guarded by a column-exists check, mirroring schema.ts's additive ALTER idiom. SQLite
  // can't ALTER-ADD a NOT NULL column to existing rows, so it lands NULLABLE; createInvite always
  // writes a non-null id, and the rebuilt DDL above makes it NOT NULL for every fresh DB.
  if (!inviteHasColumn(db, 'id')) {
    db.exec(`ALTER TABLE invites ADD COLUMN id TEXT`)
  }
}

/** Does the `invites` table already carry `column`? Used to gate the additive ALTER above for a dev
 *  DB created under P1.9 (before the `id` column existed). Mirrors schema.ts's PRAGMA-based check. */
function inviteHasColumn(db: Db, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(invites)`).all() as Array<{ name: string }>
  return cols.some((c) => c.name === column)
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
 * List EVERY membership row of one account — the by-`accountId` lookup the member-management UI
 * (P1.11) builds on ("who is in this account?"). Ordered by `createdAt` then `userId` so the member
 * list renders deterministically.
 *
 * LOUD role-integrity throw (mirrors {@link listMembershipsForUser}): a stored role that is not a
 * known {@link Role} is a control-table corruption — fail rather than hand back a mistyped,
 * access-bearing role.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose members to list.
 * @returns The account's membership rows (possibly empty), in a stable order.
 */
export function listMembersForAccount(db: Db, accountId: string): AccountMember[] {
  const rows = db
    .prepare(
      `SELECT accountId, userId, role, status, createdAt FROM account_members
       WHERE accountId = ? ORDER BY createdAt, userId`,
    )
    .all(accountId) as Array<{
    accountId: string
    userId: string
    role: string
    status: string
    createdAt: string
  }>
  return rows.map((r) => {
    if (!isKnownRole(r.role)) {
      throw new Error(
        `listMembersForAccount: stored role ${JSON.stringify(r.role)} for (${r.accountId}, ${r.userId}) is not a known role — control table corrupted.`,
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
 * Count an account's ACTIVE owners — the LAST-OWNER backstop for member-management (P1.11). The
 * server refuses to demote/remove the sole remaining owner (would strand the account ownerless); this
 * is the count that rule reads. Counts ONLY `role='owner' AND status='active'` (a non-active owner is
 * not a real owner for access purposes — see membership.ts).
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose active owners to count.
 * @returns The number of active owner memberships of `accountId`.
 */
export function countOwners(db: Db, accountId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM account_members WHERE accountId = ? AND role = 'owner' AND status = 'active'`,
    )
    .get(accountId) as { n: number }
  return row.n
}

/**
 * Remove one membership — the member-revoke write (P1.11). IDEMPOTENT: deleting an absent
 * `(accountId, userId)` is a no-op (mirrors {@link deleteRow}). The `accountId` predicate is the
 * cross-tenant guard: a revoke can only ever touch a row of the named account.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account the membership belongs to.
 * @param userId     The login whose membership to remove.
 */
export function removeMember(db: Db, accountId: string, userId: string): void {
  db.prepare(`DELETE FROM account_members WHERE accountId = ? AND userId = ?`).run(accountId, userId)
}

/**
 * Resolve display identity (name + email) for a set of user ids — the ONLY place the member-management
 * code reads Better Auth's `user` table, and ONLY to render an AUTHORIZED admin's member list. The
 * `user` table lives in the same SQLite file as the control tables (see auth.ts); this reads `name`
 * and `email` for member-row display, nothing more, and never on an unauthorized path (the caller is
 * the gated GET members route, which has already passed `manageMembers`).
 *
 * The IN-clause is built from PARAMETERISED placeholders (one `?` per id) — never string-interpolated
 * — so a crafted user id can't inject SQL. An EMPTY `ids` short-circuits to an empty map (a zero-id IN
 * clause is invalid SQL). A user id with no `user` row is simply absent from the map (the caller
 * degrades a missing identity to null, it does not throw).
 *
 * @param db   The open SQLite handle.
 * @param ids  The user ids to resolve (de-duplication is the caller's concern; duplicates are harmless).
 * @returns A Map keyed by user id → `{ name, email }` (each possibly null); ids with no row are absent.
 */
export function getUsersByIds(
  db: Db,
  ids: string[],
): Map<string, { name: string | null; email: string | null }> {
  const map = new Map<string, { name: string | null; email: string | null }>()
  if (ids.length === 0) return map // a zero-id IN () is invalid SQL — short-circuit
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT id, name, email FROM user WHERE id IN (${placeholders})`)
    .all(...ids) as Array<{ id: string; name: string | null; email: string | null }>
  for (const r of rows) map.set(r.id, { name: r.name ?? null, email: r.email ?? null })
  return map
}

/**
 * One row of the `invites` control table (P1.9): a single-use, expiring link that, when accepted by
 * a signed-in caller, binds {@link role} to that caller's membership of {@link accountId}.
 *
 * @property token         The opaque, unguessable invite secret — the link's `:token` segment AND
 *   the table's PRIMARY KEY. Treat it like a password: never log it, never return it on a read path.
 * @property id            A NON-SECRET handle (P1.11), distinct from {@link token}. list/revoke key on
 *   THIS, so the bearer `token` is write-once: minted + returned to the authorised creator and never
 *   read back. Safe to surface on a read path (it grants nothing on its own).
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
  id: string
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
    `INSERT INTO invites (token, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    invite.token,
    invite.id,
    invite.accountId,
    invite.role,
    invite.preauthEmail,
    invite.expiresAt,
    invite.usedAt,
    invite.createdAt,
  )
}

/**
 * Mint a fresh NON-SECRET invite id (P1.11) — a `randomBytes`-based value DISTINCT from the bearer
 * token. It need not be unguessable (it grants nothing on its own — list/revoke also key on
 * `accountId`), but it must be collision-resistant so two invites of one account get distinct ids;
 * 16 random bytes is ample. Kept SEPARATE from the token generator so the two are never confused.
 *
 * @returns A base64url-encoded random id for an invite row.
 */
export function newInviteId(): string {
  return randomBytes(16).toString('base64url')
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
      `SELECT token, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt FROM invites WHERE token = ?`,
    )
    .get(token) as
    | {
        token: string
        id: string
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
    id: row.id,
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

/** One row of {@link listInvitesForAccount} — an account's outstanding-invite summary for the
 *  member-management UI. DELIBERATELY has NO `token` field: the bearer token is a write-once secret
 *  (returned to the creator at mint time and never again), so a read path must never carry it. The
 *  non-secret {@link Invite.id} is what list/revoke key on. */
export interface InviteSummary {
  id: string
  accountId: string
  role: Role
  preauthEmail: string | null
  expiresAt: string
  usedAt: string | null
  createdAt: string
}

/**
 * List an account's invites for the member-management UI (P1.11) — ordered newest-first by
 * `createdAt`. CRITICAL: this NEVER selects or returns the `token` column. The token is a write-once
 * bearer secret (handed to the creator at mint time and nowhere else); returning it on this read path
 * would hand out live, role-bearing links to anyone who can list invites. list/revoke key on the
 * non-secret `id` instead.
 *
 * LOUD role-integrity throw (mirrors the other control-table readers): a stored role that is not a
 * known {@link Role} is corruption — fail rather than hand back a mistyped role.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose invites to list.
 * @returns The account's invite summaries (NO token), newest first (possibly empty).
 */
export function listInvitesForAccount(db: Db, accountId: string): InviteSummary[] {
  const rows = db
    .prepare(
      // NOTE: token is intentionally ABSENT from this SELECT — it must never leave on a read path.
      `SELECT id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt FROM invites
       WHERE accountId = ? ORDER BY createdAt DESC`,
    )
    .all(accountId) as Array<{
    id: string
    accountId: string
    role: string
    preauthEmail: string | null
    expiresAt: string
    usedAt: string | null
    createdAt: string
  }>
  return rows.map((r) => {
    if (!isKnownRole(r.role)) {
      throw new Error(
        `listInvitesForAccount: stored role ${JSON.stringify(r.role)} for invite ${r.id} is not a known role — control table corrupted.`,
      )
    }
    return {
      id: r.id,
      accountId: r.accountId,
      role: r.role,
      preauthEmail: r.preauthEmail ?? null,
      expiresAt: r.expiresAt,
      usedAt: r.usedAt ?? null,
      createdAt: r.createdAt,
    }
  })
}

/**
 * Revoke (delete) one outstanding invite by its non-secret `id` — the member-management revoke write
 * (P1.11). IDEMPOTENT: deleting an absent id is a no-op. The `accountId = ?` predicate is the
 * CROSS-TENANT guard: a revoke can only ever delete an invite of the named account, so an admin of
 * one account cannot revoke another account's invite even with its id.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account the invite must belong to (the cross-tenant guard).
 * @param id         The non-secret invite id to revoke.
 */
export function revokeInvite(db: Db, accountId: string, id: string): void {
  db.prepare(`DELETE FROM invites WHERE id = ? AND accountId = ?`).run(id, accountId)
}
