import {
  isLiveOwnershipTransferState,
  isOwnershipTransferState,
  OWNERSHIP_TRANSFER_TERMINAL_REASONS,
  type OwnershipTransferRequest,
  type OwnershipTransferState,
  type OwnershipTransferTerminalReason,
} from "@capacitylens/shared/account/ownershipTransfer";
import { OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS } from "@capacitylens/shared/account/ownershipTransferPolicy";
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

/** Reused verbatim by every statement below so no reader has to check that two hand-written copies
 *  of "live" agree with the partial index — they are the same text. */
const LIVE_STATES_PREDICATE = `state IN ('awaiting_target', 'awaiting_owner')`;

const SELECTED_COLUMNS = `id, accountId, initiatorUserId, targetUserId, state, revision,
       createdAt, expiresAt, targetAcceptedAt, terminalAt, terminalReason`;

interface OwnershipTransferRow {
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
function toOwnershipTransferRequest(row: OwnershipTransferRow, caller: string): OwnershipTransferRequest {
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

/**
 * The workflow revision one step on.
 *
 * Stored as an integer STRING to match the `membershipRevision` convention the rest of the account
 * contract already uses, so every revision a client sees has one wire shape. Parsed strictly: a
 * non-integer revision is corruption of the value that stops a stale command applying to a later
 * acceptance cycle, and continuing from a guess would defeat exactly that protection.
 */
export function nextOwnershipTransferRevision(revision: string): string {
  const current = Number(revision);
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new Error(
      `nextOwnershipTransferRevision: stored revision ${JSON.stringify(revision)} is not a non-negative integer — control table corrupted.`,
    );
  }
  return String(current + 1);
}

/** The company's live request, or `null`. At most one row can match — the partial unique index is
 *  what makes that a guarantee rather than a convention. */
export function readLiveRequest(db: Db, accountId: string): OwnershipTransferRequest | null {
  const row = db
    .prepare(
      `SELECT ${SELECTED_COLUMNS} FROM account_ownership_transfers WHERE accountId = ? AND ${LIVE_STATES_PREDICATE}`,
    )
    .get(accountId) as OwnershipTransferRow | undefined;
  return row ? toOwnershipTransferRequest(row, "readLiveRequest") : null;
}

/**
 * One request by id, whatever its state.
 *
 * `accountId` is a REQUIRED parameter rather than a convenience: it is the cross-tenant guard. Every
 * ceremony command carries the workspace it was authorised against, so keying the read on both makes
 * a request id from another company indistinguishable from an absent one at the storage layer,
 * instead of relying on each caller to compare the row's `accountId` afterwards.
 */
export function readRequestById(db: Db, accountId: string, id: string): OwnershipTransferRequest | null {
  const row = db
    .prepare(`SELECT ${SELECTED_COLUMNS} FROM account_ownership_transfers WHERE id = ? AND accountId = ?`)
    .get(id, accountId) as OwnershipTransferRow | undefined;
  return row ? toOwnershipTransferRequest(row, "readRequestById") : null;
}

/**
 * The most recent TERMINAL request this principal took part in, or `null`.
 *
 * The second half of the participant projection. A live-only read hands an offline participant
 * `null` for a decline, a cancellation, an expiry and an invalidation alike; this is how they learn
 * which of the four happened. Ordered by `terminalAt` then `id` so the answer is deterministic when
 * two rows share an instant.
 */
export function readLatestTerminalForParticipant(
  db: Db,
  accountId: string,
  userId: string,
): OwnershipTransferRequest | null {
  const row = db
    .prepare(
      `SELECT ${SELECTED_COLUMNS}
         FROM account_ownership_transfers
        WHERE accountId = ? AND NOT (${LIVE_STATES_PREDICATE})
          AND (initiatorUserId = ? OR targetUserId = ?)
        ORDER BY terminalAt DESC, id ASC
        LIMIT 1`,
    )
    .get(accountId, userId, userId) as OwnershipTransferRow | undefined;
  return row ? toOwnershipTransferRequest(row, "readLatestTerminalForParticipant") : null;
}

/**
 * Persist a newly initiated request.
 *
 * Synchronous and transaction-agnostic like every function here: the caller owns the transaction,
 * because an initiation commits alongside its command-ledger row and its audit event or not at all.
 *
 * Deliberately NOT preceded by a "is there already a live request?" read. The partial unique index
 * refuses the second live row, so a concurrent second initiation surfaces as a SQLite constraint
 * error the caller maps to a conflict. A read-then-insert would pass both racers.
 */
export function insertRequest(db: Db, request: OwnershipTransferRequest): void {
  db.prepare(
    `INSERT INTO account_ownership_transfers
       (id, accountId, initiatorUserId, targetUserId, state, revision,
        createdAt, expiresAt, targetAcceptedAt, terminalAt, terminalReason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    request.id,
    request.accountId,
    request.initiatorUserId,
    request.targetUserId,
    request.state,
    request.revision,
    request.createdAt,
    request.expiresAt,
    request.targetAcceptedAt,
    request.terminalAt,
    request.terminalReason,
  );
}

interface ApplyTransitionInput {
  db: Db;
  /** The request to move, together with the workspace it must belong to. */
  id: string;
  accountId: string;
  /** The state and revision the command was authorised against — the compare half of the CAS. */
  expectedState: OwnershipTransferState;
  expectedRevision: string;
  nextState: OwnershipTransferState;
  nextRevision: string;
  /** The three mutable columns are always written explicitly, never left to carry over: `withdraw`
   *  must CLEAR `targetAcceptedAt`, so an omitted column would silently keep a consent that was
   *  taken back. */
  targetAcceptedAt: string | null;
  terminalAt: string | null;
  terminalReason: OwnershipTransferTerminalReason | null;
}

/**
 * Compare-and-set one transition, returning whether it applied.
 *
 * The `WHERE` clause matches on `(id, accountId, state, revision)` and NOTHING else — in particular
 * never on membership values, because completion bumps those in the same transaction and a
 * membership-sensitive predicate would make the ceremony's own write unable to find its row.
 *
 * `false` means the row moved under the caller (a concurrent cancel, accept or invalidation), and
 * NOTHING was written. It is not an error here: the caller decides whether that is a conflict to
 * report or a race it loses quietly, and only the caller knows which command it was running.
 *
 * @throws Error if `expectedState` is terminal. Terminal rows are IMMUTABLE — they are the durable
 *   evidence a participant reads — so a caller asking to transition one is a programming fault, not
 *   a lost race, and must fail loudly rather than return an ambiguous `false`.
 */
export function applyTransition({
  db,
  id,
  accountId,
  expectedState,
  expectedRevision,
  nextState,
  nextRevision,
  targetAcceptedAt,
  terminalAt,
  terminalReason,
}: ApplyTransitionInput): boolean {
  if (!isLiveOwnershipTransferState(expectedState)) {
    throw new Error(`applyTransition: ${expectedState} is terminal and cannot be transitioned (request ${id}).`);
  }
  const result = db
    .prepare(
      `UPDATE account_ownership_transfers
          SET state = ?, revision = ?, targetAcceptedAt = ?, terminalAt = ?, terminalReason = ?
        WHERE id = ? AND accountId = ? AND state = ? AND revision = ?`,
    )
    .run(
      nextState,
      nextRevision,
      targetAcceptedAt,
      terminalAt,
      terminalReason,
      id,
      accountId,
      expectedState,
      expectedRevision,
    );
  return result.changes === 1;
}

interface TerminaliseForAccountInput {
  db: Db;
  accountId: string;
  reason: OwnershipTransferTerminalReason;
  /** The ISO instant stamped as `terminalAt` — the value written, not a clock read here, so the
   *  whole transaction that caused the invalidation shares one instant. */
  now: string;
}

interface TerminaliseForMemberInput extends TerminaliseForAccountInput {
  userId: string;
}

/**
 * Invalidate every live request of one company, returning the ids actually changed.
 *
 * The ids are the return value because the choke point that calls this holds no audit writer: the
 * calling port operation — inside the SAME transaction — emits one `ownership_transfer.invalidated`
 * event per id. State correctness stays unforgettable down here; audit stays atomic with the write.
 *
 * The resulting state is always `invalidated`: `reason` says why consent stopped being valid, it
 * does not select a different outcome. A deadline that has passed is `expired` and is materialised
 * by the command path, not here.
 */
export function terminaliseLiveRequestsForAccount({
  db,
  accountId,
  reason,
  now,
}: TerminaliseForAccountInput): string[] {
  return invalidateLive({ db, now, reason, predicate: "", parameters: [accountId] });
}

/**
 * Invalidate every live request naming one principal, returning the ids actually changed.
 *
 * Called from the membership-write choke point in the same transaction as the write that caused it,
 * so consent is bound EAGERLY: demotion, re-promotion, status change and removal each kill the
 * request when they happen, and no later transition can resurrect it.
 *
 * Scoped to `accountId` as well as `userId`: a principal may hold memberships in several companies,
 * and a role change in one of them says nothing about a ceremony running in another.
 */
export function terminaliseLiveRequestsForMember({
  db,
  accountId,
  userId,
  reason,
  now,
}: TerminaliseForMemberInput): string[] {
  return invalidateLive({
    db,
    now,
    reason,
    predicate: " AND (initiatorUserId = ? OR targetUserId = ?)",
    parameters: [accountId, userId, userId],
  });
}

interface InvalidateLiveInput {
  db: Db;
  now: string;
  reason: OwnershipTransferTerminalReason;
  predicate: string;
  parameters: string[];
}

/** The shared body of the two terminalisers. Reads the matching ids BEFORE the update so the caller
 *  learns exactly which rows it changed; both statements run inside the caller's transaction, so no
 *  row can appear or disappear between them. */
function invalidateLive({ db, now, reason, predicate, parameters }: InvalidateLiveInput): string[] {
  const where = `accountId = ? AND ${LIVE_STATES_PREDICATE}${predicate}`;
  const ids = (
    db.prepare(`SELECT id FROM account_ownership_transfers WHERE ${where}`).all(...parameters) as Array<{ id: string }>
  ).map(({ id }) => id);
  if (ids.length === 0) return [];
  db.prepare(
    `UPDATE account_ownership_transfers
        SET state = 'invalidated', terminalAt = ?, terminalReason = ?,
            revision = CAST(CAST(revision AS INTEGER) + 1 AS TEXT)
      WHERE ${where}`,
  ).run(now, reason, ...parameters);
  return ids;
}

/**
 * Delete every request row of one company — live and terminal alike.
 *
 * Workspace erasure calls this explicitly. There is no `accounts` cascade to rely on (this table
 * carries no FK by design), so without an explicit delete an erased company would leave behind rows
 * naming two of its principals. Erasure terminalises and audits first, then deletes: the audit trail
 * of WHY the ceremony ended outlives the rows, under audit policy rather than this table's.
 */
export function deleteRequestsForAccount(db: Db, accountId: string): void {
  db.prepare(`DELETE FROM account_ownership_transfers WHERE accountId = ?`).run(accountId);
}

/**
 * Remove terminal rows whose retention window has passed, returning how many were removed.
 *
 * Only terminal rows can match: the table CHECK gives a live row a NULL `terminalAt`, so the
 * predicate cannot reach a running ceremony however far in the past its `createdAt` is.
 *
 * @param now  The current instant in epoch milliseconds — arithmetic, not a stamp, which is why
 *   this one takes a number where the terminalisers take the ISO instant they WRITE.
 */
export function sweepExpiredHistory(db: Db, now: number): number {
  if (!Number.isFinite(now)) {
    throw new Error(`sweepExpiredHistory: ${JSON.stringify(now)} is not a usable current instant.`);
  }
  const cutoff = new Date(now - OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS).toISOString();
  const { changes } = db
    .prepare(`DELETE FROM account_ownership_transfers WHERE terminalAt IS NOT NULL AND terminalAt < ?`)
    .run(cutoff);
  return Number(changes);
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
