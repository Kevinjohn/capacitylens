import {
  isOwnershipTransferState,
  OWNERSHIP_TRANSFER_TERMINAL_REASONS,
  type OwnershipTransferRequest,
  type OwnershipTransferTerminalReason,
} from "@capacitylens/shared/account/ownershipTransfer";
import type { Db } from "../db";

/**
 * The `account_ownership_transfers` control table: the durable record of the three-step ownership
 * transfer ceremony.
 *
 * This is a SERVER-CONTROL table, not AppData — the same zone as `account_members` and `invites`
 * (see the header of `controlTables.ts`). It is deliberately absent from shared `AppData`,
 * `APP_DATA_KEYS`, `SCOPED_KEYS`, `tables.ts`, `sanitizeImportedRecord`, the generic `/api/:entity`
 * CRUD and import/export, and `EXPORT_SCHEMA_VERSION` does not move for it. A row names two
 * principals and confers a pending elevation path, so letting it reach the entity machinery would
 * publish who is being handed the company through the ordinary state read.
 *
 * FROZEN v40 migration body, and the v40 LEDGER DEFINITION itself: the executed SQL is the hashed
 * manifest, one copy, so the checksum can never describe something other than what ran (the same
 * arrangement as `FOREIGN_KEY_CHILD_INDEXES_V23_SQL`). The state and reason lists are spelled out as LITERALS rather than
 * interpolated from the shared unions on purpose: this SQL is folded into the v40 ledger checksum,
 * and a checksummed migration that read a live shared constant would silently change what it
 * installs while its checksum stayed the same. A test asserts the literals still match the shared
 * unions, so drift is caught in review rather than on disk; a genuinely new state would be a NEW
 * migration with its own checksum, never an edit to this string.
 *
 * NO FOREIGN KEY to `accounts(id)`, and none to `account_members` either:
 *
 * - Control-plane tables carry no FK BY DESIGN (see `ensureControlTables` in `retentionV24.ts`), so
 *   they stay out of the AppData delete cascade and out of `PRAGMA foreign_key_check`. Deletion is
 *   explicit — {@link deleteRequestsForAccount} is what workspace erasure calls.
 * - A membership FK would be actively wrong: removing a member must invalidate their live request,
 *   not cascade away the retained terminal history that tells the other participant what happened.
 *
 * The partial UNIQUE index over the two live states is the one-live-request-per-company guarantee.
 * It is an index rather than a read-then-insert check because two concurrent initiations would both
 * read "no live request" and both insert; SQLite refusing the second write is the only version of
 * this rule that holds under concurrency.
 */
export const OWNERSHIP_TRANSFER_REQUESTS_V40_SQL = `
CREATE TABLE IF NOT EXISTS account_ownership_transfers (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL,
  initiatorUserId TEXT NOT NULL,
  targetUserId TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN (
    'awaiting_target', 'awaiting_owner', 'declined', 'cancelled', 'expired', 'invalidated', 'completed'
  )),
  revision TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  targetAcceptedAt TEXT,
  terminalAt TEXT,
  terminalReason TEXT CHECK(terminalReason IS NULL OR terminalReason IN (
    'target_declined', 'owner_cancelled', 'replaced', 'deadline_passed', 'initiator_not_owner',
    'target_not_admin', 'participant_membership_changed', 'account_erased', 'owner_repaired'
  )),
  CHECK(initiatorUserId <> targetUserId),
  CHECK(createdAt < expiresAt),
  CHECK(
    (state IN ('awaiting_target', 'awaiting_owner') AND terminalAt IS NULL AND terminalReason IS NULL) OR
    (state NOT IN ('awaiting_target', 'awaiting_owner') AND terminalAt IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_ownership_transfers_live
  ON account_ownership_transfers(accountId) WHERE state IN ('awaiting_target', 'awaiting_owner');

CREATE INDEX IF NOT EXISTS idx_account_ownership_transfers_account_target
  ON account_ownership_transfers(accountId, targetUserId);
`;

/** The partial unique index that physically enforces "at most one live request per company". */
export const OWNERSHIP_TRANSFER_LIVE_INDEX = "idx_account_ownership_transfers_live";

/** The `(accountId, targetUserId)` lookup index behind "is this Admin the current nominee?". */
export const OWNERSHIP_TRANSFER_TARGET_INDEX = "idx_account_ownership_transfers_account_target";

/** Reused verbatim by every statement in `ownershipTransfers.ts` so no reader has to check that two
 *  hand-written copies of "live" agree with the partial index — they are the same text. */
export const LIVE_STATES_PREDICATE = `state IN ('awaiting_target', 'awaiting_owner')`;

export const SELECTED_COLUMNS = `id, accountId, initiatorUserId, targetUserId, state, revision,
       createdAt, expiresAt, targetAcceptedAt, terminalAt, terminalReason`;

export interface OwnershipTransferRow {
  id: string;
  accountId: string;
  initiatorUserId: string;
  targetUserId: string;
  state: string;
  revision: string;
  createdAt: string;
  expiresAt: string;
  targetAcceptedAt: string | null;
  terminalAt: string | null;
  terminalReason: string | null;
}

function isTerminalReason(value: string): value is OwnershipTransferTerminalReason {
  return (OWNERSHIP_TRANSFER_TERMINAL_REASONS as readonly string[]).includes(value);
}

/**
 * Map one raw row onto the shared {@link OwnershipTransferRequest}, failing LOUD on a stored state
 * or reason outside the shared unions.
 *
 * Same convention as `toAccountMember`: an unreadable control row is corruption, never a
 * recoverable request condition. Coercing it would be worse than throwing — a state we cannot
 * interpret still holds the company's single live slot, and guessing "terminal" would release that
 * slot while guessing "live" would block the ceremony forever. Neither guess is safe, so we refuse.
 */
export function toOwnershipTransferRequest(row: OwnershipTransferRow, caller: string): OwnershipTransferRequest {
  if (!isOwnershipTransferState(row.state)) {
    throw new Error(
      `${caller}: stored state ${JSON.stringify(row.state)} for transfer ${row.id} is not a known ownership-transfer state — control table corrupted.`,
    );
  }
  if (row.terminalReason !== null && !isTerminalReason(row.terminalReason)) {
    throw new Error(
      `${caller}: stored terminal reason ${JSON.stringify(row.terminalReason)} for transfer ${row.id} is not a known reason — control table corrupted.`,
    );
  }
  return {
    id: row.id,
    accountId: row.accountId,
    initiatorUserId: row.initiatorUserId,
    targetUserId: row.targetUserId,
    state: row.state,
    revision: row.revision,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    // Coerce SQLite's nullable columns to a real `null` (mirrors getInvite) so the contract is
    // honest and a future driver change cannot leak `undefined` into a participant projection.
    targetAcceptedAt: row.targetAcceptedAt ?? null,
    terminalAt: row.terminalAt ?? null,
    terminalReason: row.terminalReason ?? null,
  };
}

interface ExpectedColumn {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

const EXPECTED_COLUMNS: readonly ExpectedColumn[] = [
  { name: "id", type: "TEXT", notnull: 1, pk: 1 },
  { name: "accountId", type: "TEXT", notnull: 1, pk: 0 },
  { name: "initiatorUserId", type: "TEXT", notnull: 1, pk: 0 },
  { name: "targetUserId", type: "TEXT", notnull: 1, pk: 0 },
  { name: "state", type: "TEXT", notnull: 1, pk: 0 },
  { name: "revision", type: "TEXT", notnull: 1, pk: 0 },
  { name: "createdAt", type: "TEXT", notnull: 1, pk: 0 },
  { name: "expiresAt", type: "TEXT", notnull: 1, pk: 0 },
  { name: "targetAcceptedAt", type: "TEXT", notnull: 0, pk: 0 },
  { name: "terminalAt", type: "TEXT", notnull: 0, pk: 0 },
  { name: "terminalReason", type: "TEXT", notnull: 0, pk: 0 },
];

function normalizeSql(sql: string): string {
  return sql
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*([(),=])\s*/g, "$1")
    .replace(/;$/, "")
    .trim();
}

/**
 * Verify the workflow table after migration and on every open.
 *
 * This table sits outside AppData/TABLES, so `schema.ts` cannot cover it — and it is installed at
 * v40, so the historical `assertControlTablesCurrent` cannot either (migration v24 runs that
 * assertion against a v23 database, where a v40 table is correctly absent). It therefore gets its
 * own assertion, in the same shape as `assertAuditOutboxCurrent`.
 *
 * The live index is checked by its full DEFINITION, not merely its presence: an index that existed
 * but had lost its partial predicate would still satisfy a presence check while silently permitting
 * a second live request — the one thing this table exists to prevent.
 */
export function assertOwnershipTransfersCurrent(db: Db): void {
  const columns = (
    db.prepare(`PRAGMA table_info(account_ownership_transfers)`).all() as unknown as ExpectedColumn[]
  ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));
  if (JSON.stringify(columns) !== JSON.stringify(EXPECTED_COLUMNS)) {
    throw new Error("Ownership-transfer schema does not match the current ceremony contract.");
  }
  const indexes = new Map(
    (
      db
        .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`)
        .all("account_ownership_transfers") as Array<{ name: string; sql: string | null }>
    ).map((index) => [index.name, index.sql]),
  );
  const expectedLive = normalizeSql(
    `CREATE UNIQUE INDEX ${OWNERSHIP_TRANSFER_LIVE_INDEX} ON account_ownership_transfers(accountId) WHERE state IN ('awaiting_target', 'awaiting_owner')`,
  );
  const liveSql = indexes.get(OWNERSHIP_TRANSFER_LIVE_INDEX);
  if (!liveSql || normalizeSql(liveSql) !== expectedLive) {
    throw new Error(
      `DB control schema has an invalid definition for partial unique index ${OWNERSHIP_TRANSFER_LIVE_INDEX}.`,
    );
  }
  if (!indexes.has(OWNERSHIP_TRANSFER_TARGET_INDEX)) {
    throw new Error(`DB control schema is missing index ${OWNERSHIP_TRANSFER_TARGET_INDEX}.`);
  }
}
