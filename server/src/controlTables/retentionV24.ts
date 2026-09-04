import type { Db } from "../db";
import { migrateMemberSignInTrackingV26 } from "../accounts/memberSignInTracking";
import { inviteTokenHash, newInviteId } from "./inviteTokens";
import { hasColumn } from "../schema";
import { tx } from "../txn";
import type { Invite } from "./invites";

export const USED_INVITATION_RETENTION_LIMIT = 200;
export const USED_INVITATION_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;
export const INVITATION_RETENTION_INDEXES_V24_SQL = `
CREATE INDEX IF NOT EXISTS idx_invites_account_usedAt_id
  ON invites(accountId, usedAt DESC, id) WHERE usedAt IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invites_live_preauthEmail
  ON invites(preauthEmail) WHERE usedAt IS NULL AND preauthEmail IS NOT NULL;
`;
export const USED_INVITATION_RETENTION_V24_DEFINITION = [
  `policy:retain-newest-${USED_INVITATION_RETENTION_LIMIT}-used-invitations-per-account:v1`,
  `policy:retain-used-invitations-for-${USED_INVITATION_RETENTION_MS}-milliseconds:v1`,
  "ordering:usedAt-instant-descending-then-id-ascending:v1",
  "malformed-usedAt:remove:v1",
  INVITATION_RETENTION_INDEXES_V24_SQL,
].join("\n-- migration component --\n");

/**
 * Create the membership control table (and its lookup indexes) if absent. IDEMPOTENT — every
 * statement is `IF NOT EXISTS`, so this is safe to run on EVERY boot and on every opened DB
 * (including the `:memory:` databases tests open via openDb).
 *
 * Schema: `account_members(accountId, userId, role, status, createdAt, signInConfirmed?)` with a composite
 * PRIMARY KEY `(accountId, userId)` (a login has at most one role per account), plus a
 * by-`userId` index (P1.2's listAccounts: "which accounts can this login see?") and a
 * by-`accountId` index (member-management listing: "who is in this account?").
 *
 * Also creates `invites(tokenHash PK, id, accountId, role, preauthEmail?, expiresAt, usedAt?, createdAt)`
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
      signInConfirmed TEXT CHECK(signInConfirmed IS NULL OR signInConfirmed IN ('false', 'true')),
      PRIMARY KEY (accountId, userId)
    );
    CREATE INDEX IF NOT EXISTS idx_account_members_userId ON account_members(userId);
    CREATE INDEX IF NOT EXISTS idx_account_members_accountId ON account_members(accountId);
    CREATE TABLE IF NOT EXISTS invites (
      tokenHash TEXT NOT NULL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,      -- NON-SECRET handle (P1.11); list/revoke key on this, never the token
      accountId TEXT NOT NULL,
      role TEXT NOT NULL,
      preauthEmail TEXT,            -- NULLABLE; P1.10 (email-preauth) uses it; P1.9 always writes NULL
      expiresAt TEXT NOT NULL,
      usedAt TEXT,                  -- NULL = unused; set once on accept (single-use)
      createdAt TEXT NOT NULL
    );
  `);
  // The v26 migration owns this additive shape. Repeating its guarded repair here keeps fresh and
  // pre-ledger development databases on the same every-boot control-plane boundary as invites.
  migrateMemberSignInTrackingV26(db);
  // ADDITIVE column for an ALREADY-CREATED dev DB (the `invites` table is new in P1.9; the `id`
  // column is added in P1.11). A DB that already has the table from P1.9 won't get `id` from the
  // IF-NOT-EXISTS CREATE above (node:sqlite never re-runs CREATE on an existing table), so add it
  // here — guarded by a column-exists check, mirroring schema.ts's additive ALTER idiom. SQLite
  // can't ALTER-ADD a NOT NULL column to existing rows, so it lands NULLABLE; createInvite always
  // writes a non-null id, and the rebuilt DDL above makes it NOT NULL for every fresh DB.
  // Fetch the invites column set ONCE (rather than one PRAGMA per column checked below) — both
  // `legacyPlaintextInvites` and the `id`-presence check below read the same live shape.
  const inviteColumnNames = new Set(
    (db.prepare(`PRAGMA table_info(invites)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  const legacyPlaintextInvites = inviteColumnNames.has("token");
  if (!legacyPlaintextInvites && !inviteColumnNames.has("id")) db.exec(`ALTER TABLE invites ADD COLUMN id TEXT`);

  // Migrate the original schema, which stored bearer tokens verbatim as its primary key. Rebuild
  // rather than retaining the old column: leaving plaintext beside a new digest would not improve
  // backup compromise. Existing nullable ids are backfilled before the NOT NULL+UNIQUE invariant is
  // installed, so every legacy invite remains independently revocable.
  if (legacyPlaintextInvites) {
    tx(db, () => {
      if (!hasColumn(db, "invites", "id")) db.exec(`ALTER TABLE invites ADD COLUMN id TEXT`);
      // A previous interrupted pre-fix migration may have left this scratch table behind.
      db.exec(`DROP TABLE IF EXISTS invites_new`);
      const rows = db.prepare(`SELECT token, id FROM invites`).all() as Array<{ token: string; id: string | null }>;
      const ids = new Set<string>();
      const replacements = rows.map((row) => {
        let id = row.id;
        while (!id || ids.has(id)) id = newInviteId();
        ids.add(id);
        return { token: row.token, id };
      });
      const updateId = db.prepare(`UPDATE invites SET id = ? WHERE token = ?`);
      for (const row of replacements) updateId.run(row.id, row.token);
      db.exec(`
        CREATE TABLE invites_new (
          tokenHash TEXT NOT NULL PRIMARY KEY,
          id TEXT NOT NULL UNIQUE,
          accountId TEXT NOT NULL,
          role TEXT NOT NULL,
          preauthEmail TEXT,
          expiresAt TEXT NOT NULL,
          usedAt TEXT,
          createdAt TEXT NOT NULL
        )
      `);
      const oldRows = db
        .prepare(`SELECT token, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt FROM invites`)
        .all() as unknown as Array<Invite>;
      const insert = db.prepare(
        `INSERT INTO invites_new (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of oldRows)
        insert.run(
          inviteTokenHash(row.token),
          row.id,
          row.accountId,
          row.role,
          row.preauthEmail,
          row.expiresAt,
          row.usedAt,
          row.createdAt,
        );
      db.exec(`DROP TABLE invites; ALTER TABLE invites_new RENAME TO invites;`);
    });
  }
  const idColumn = (
    db.prepare(`PRAGMA table_info(invites)`).all() as Array<{
      name: string;
      notnull: number;
    }>
  ).find((column) => column.name === "id");
  if (!legacyPlaintextInvites && idColumn?.notnull !== 1) {
    tx(db, () => {
      const rows = db.prepare(`SELECT tokenHash, id FROM invites`).all() as Array<{
        tokenHash: string;
        id: string | null;
      }>;
      const ids = new Set<string>();
      const updateId = db.prepare(`UPDATE invites SET id = ? WHERE tokenHash = ?`);
      for (const row of rows) {
        let id = row.id;
        while (!id || ids.has(id)) id = newInviteId();
        ids.add(id);
        updateId.run(id, row.tokenHash);
      }
      db.exec(`
        DROP TABLE IF EXISTS invites_new;
        CREATE TABLE invites_new (
          tokenHash TEXT NOT NULL PRIMARY KEY,
          id TEXT NOT NULL UNIQUE,
          accountId TEXT NOT NULL,
          role TEXT NOT NULL,
          preauthEmail TEXT,
          expiresAt TEXT NOT NULL,
          usedAt TEXT,
          createdAt TEXT NOT NULL
        );
        INSERT INTO invites_new (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
          SELECT tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt FROM invites;
        DROP TABLE invites;
        ALTER TABLE invites_new RENAME TO invites;
      `);
    });
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_id ON invites(id); CREATE INDEX IF NOT EXISTS idx_invites_accountId ON invites(accountId); ${INVITATION_RETENTION_INDEXES_V24_SQL}`,
  );
}
