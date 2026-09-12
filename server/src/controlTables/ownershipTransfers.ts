import {
  isLiveOwnershipTransferState,
  type OwnershipTransferRequest,
  type OwnershipTransferState,
  type OwnershipTransferTerminalReason,
} from "@capacitylens/shared/account/ownershipTransfer";
import { OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS } from "@capacitylens/shared/account/ownershipTransferPolicy";
import { createTableExistenceProbe } from "../auth";
import type { Db } from "../db";
import { cachedStatement, type PreparedStatement } from "./preparedStatement";
import {
  LIVE_STATES_PREDICATE,
  type OwnershipTransferRow,
  SELECTED_COLUMNS,
  toOwnershipTransferRequest,
} from "./ownershipTransfersSchema";

/**
 * Storage operations over the `account_ownership_transfers` control table.
 *
 * The table's own contract — its frozen v41 DDL, its indexes, the row shape and the boot-time
 * assertion — lives in `ownershipTransfersSchema.ts`. Everything here is a statement against that
 * contract: every function is synchronous and transaction-agnostic, because a ceremony write commits
 * alongside its command-ledger row and its audit event or not at all, and only the caller owns that
 * transaction.
 */

/**
 * Not every handle that reaches the terminalisers HAS this table.
 *
 * Two callers arrive before v41 exists: the membership choke point, which application migrations
 * v12 and v14 drive on a handle where `ensureControlTables` has installed the membership tables but
 * not this one; and the stopped-server repair commands, which deliberately run against a database
 * whose migration 40 is still pending. A live request cannot exist in either case, so absence means
 * "nothing to end" — but the query would still throw. Guarding HERE, rather than at each call site,
 * is what keeps a repair path from failing with an opaque `no such table`. Absence is re-probed
 * every call, never cached, so the same handle starts terminalising the moment v41 runs on it.
 */
const ownershipTransfersTableExists = createTableExistenceProbe("account_ownership_transfers");

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
const liveRequestStatement = cachedStatement(
  `SELECT ${SELECTED_COLUMNS} FROM account_ownership_transfers WHERE accountId = ? AND ${LIVE_STATES_PREDICATE}`,
);

export function readLiveRequest(db: Db, accountId: string): OwnershipTransferRequest | null {
  const row = liveRequestStatement(db).get(accountId) as OwnershipTransferRow | undefined;
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
const requestByIdStatement = cachedStatement(
  `SELECT ${SELECTED_COLUMNS} FROM account_ownership_transfers WHERE id = ? AND accountId = ?`,
);

export function readRequestById(db: Db, accountId: string, id: string): OwnershipTransferRequest | null {
  const row = requestByIdStatement(db).get(id, accountId) as OwnershipTransferRow | undefined;
  return row ? toOwnershipTransferRequest(row, "readRequestById") : null;
}

const latestTerminalStatement = cachedStatement(
  `SELECT ${SELECTED_COLUMNS}
     FROM account_ownership_transfers
    WHERE accountId = ? AND NOT (${LIVE_STATES_PREDICATE})
      AND (initiatorUserId = ? OR targetUserId = ?)
    ORDER BY terminalAt DESC, id ASC
    LIMIT 1`,
);

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
  const row = latestTerminalStatement(db).get(accountId, userId, userId) as OwnershipTransferRow | undefined;
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
const insertRequestStatement = cachedStatement(
  `INSERT INTO account_ownership_transfers
     (id, accountId, initiatorUserId, targetUserId, state, revision,
      createdAt, expiresAt, targetAcceptedAt, terminalAt, terminalReason)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

export function insertRequest(db: Db, request: OwnershipTransferRequest): void {
  insertRequestStatement(db).run(
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

const applyTransitionStatement = cachedStatement(
  `UPDATE account_ownership_transfers
      SET state = ?, revision = ?, targetAcceptedAt = ?, terminalAt = ?, terminalReason = ?
    WHERE id = ? AND accountId = ? AND state = ? AND revision = ?`,
);

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
  const result = applyTransitionStatement(db).run(
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
  return invalidateLive({ db, now, reason, scope: ACCOUNT_SCOPE, parameters: [accountId] });
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
  return invalidateLive({ db, now, reason, scope: MEMBER_SCOPE, parameters: [accountId, userId, userId] });
}

/** The two row sets an invalidation can name: one company's live requests, or the subset of them
 *  naming one principal. Each is a fixed pair of statements rather than an interpolated predicate,
 *  because this runs from the membership-write choke point and a per-call `prepare()` there is a
 *  SQL compile on the hot path. */
interface InvalidateScope {
  select: (db: Db) => PreparedStatement;
  update: (db: Db) => PreparedStatement;
}

function invalidateScope(predicate: string): InvalidateScope {
  const where = `accountId = ? AND ${LIVE_STATES_PREDICATE}${predicate}`;
  return {
    select: cachedStatement(`SELECT id FROM account_ownership_transfers WHERE ${where}`),
    update: cachedStatement(
      `UPDATE account_ownership_transfers
          SET state = 'invalidated', terminalAt = ?, terminalReason = ?,
              revision = CAST(CAST(revision AS INTEGER) + 1 AS TEXT)
        WHERE ${where}`,
    ),
  };
}

const ACCOUNT_SCOPE = invalidateScope("");
const MEMBER_SCOPE = invalidateScope(" AND (initiatorUserId = ? OR targetUserId = ?)");

interface InvalidateLiveInput {
  db: Db;
  now: string;
  reason: OwnershipTransferTerminalReason;
  scope: InvalidateScope;
  /** The `accountId` the scope's `where` opens with, followed by whatever its predicate adds. */
  parameters: string[];
}

/** The shared body of the two terminalisers. Reads the matching ids BEFORE the update so the caller
 *  learns exactly which rows it changed; both statements run inside the caller's transaction, so no
 *  row can appear or disappear between them. */
function invalidateLive({ db, now, reason, scope, parameters }: InvalidateLiveInput): string[] {
  if (!ownershipTransfersTableExists(db)) return [];
  const ids = (scope.select(db).all(...parameters) as Array<{ id: string }>).map(({ id }) => id);
  if (ids.length === 0) return [];
  scope.update(db).run(now, reason, ...parameters);
  return ids;
}

const deleteForAccountStatement = cachedStatement(`DELETE FROM account_ownership_transfers WHERE accountId = ?`);

/**
 * Delete every request row of one company — live and terminal alike.
 *
 * Workspace erasure calls this explicitly. There is no `accounts` cascade to rely on (this table
 * carries no FK by design), so without an explicit delete an erased company would leave behind rows
 * naming two of its principals. Erasure deletes rather than terminalising first: the delete runs in
 * the same transaction, so an invalidation written before it would never be visible to anyone, and
 * the audit trail of WHY the ceremony ended outlives the rows under audit policy.
 */
export function deleteRequestsForAccount(db: Db, accountId: string): void {
  if (!ownershipTransfersTableExists(db)) return;
  deleteForAccountStatement(db).run(accountId);
}

const sweepHistoryStatement = cachedStatement(
  `DELETE FROM account_ownership_transfers WHERE accountId = ? AND terminalAt IS NOT NULL AND terminalAt < ?`,
);

/**
 * Remove terminal rows whose retention window has passed, returning how many were removed.
 *
 * Only terminal rows can match: the table CHECK gives a live row a NULL `terminalAt`, so the
 * predicate cannot reach a running ceremony however far in the past its `createdAt` is.
 *
 * Scoped to ONE company, like `pruneInvites`: this runs from a ceremony command, inside a mutation
 * holding that workspace's lock and audited against that workspace. An unscoped DELETE would let one
 * company's cancel remove another company's rows, outside any lock the caller holds — retention is a
 * per-company policy, not a housekeeping job that rides along with whoever writes next.
 *
 * @param accountId  The company whose history is being bounded — the workspace the caller's mutation
 *   is locked and audited against.
 * @param now  The current instant in epoch milliseconds — arithmetic, not a stamp, which is why
 *   this one takes a number where the terminalisers take the ISO instant they WRITE.
 */
export function sweepExpiredHistory(db: Db, accountId: string, now: number): number {
  if (!Number.isFinite(now)) {
    throw new Error(`sweepExpiredHistory: ${JSON.stringify(now)} is not a usable current instant.`);
  }
  const cutoff = new Date(now - OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS).toISOString();
  const { changes } = sweepHistoryStatement(db).run(accountId, cutoff);
  return Number(changes);
}
