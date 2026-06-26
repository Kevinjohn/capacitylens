import type { Role } from '@capacitylens/shared/domain/access'
import type { Db } from './db'

// Server-CONTROL tables — the user↔account binding (membership) and its roles. These mirror Better
// Auth's own user/session/account tables (see auth.ts): they live in the same SQLite file but are
// DELIBERATELY OUTSIDE the AppData drift path. `account_members` is intentionally absent from
// shared AppData / SCOPED_KEYS, tables.ts TABLES / CREATE_ORDER / SCOPED_ORDER, KNOWN_KEYS, the seed
// fixtures, sanitizeImportedRecord, loadState, the generic /api/:entity CRUD, and import/export. It
// is reached ONLY through the helpers below, which permissioned endpoints (P1.2 / P1.5) wrap — never
// through the entity machinery. Keeping it off that path is the whole point: if it were AppData it
// would leak through generic CRUD and the state read/export.

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
 * No FOREIGN KEY to `accounts(id)` BY DESIGN: this is a control-plane table that must stay
 * decoupled from the AppData cascade — it must never be dragged into the entity drift path, and
 * membership is managed by dedicated permissioned endpoints, not by the AppData delete cascade. It
 * therefore carries no FK, so the caller's `PRAGMA foreign_keys` state is irrelevant to it.
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
