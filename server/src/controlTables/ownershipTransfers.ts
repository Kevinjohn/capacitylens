import { isLiveOwnershipTransferState } from "@capacitylens/shared/account/ownershipTransfer";
import type {
  OwnershipTransferRequest,
  OwnershipTransferState,
  OwnershipTransferTerminalReason,
} from "@capacitylens/shared/account/ownershipTransfer";
import { OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS } from "@capacitylens/shared/account/ownershipTransferPolicy";
import { createTableExistenceProbe } from "../authConfig/tableAccess";
import type { Db } from "../db";
import { cachedStatement } from "./preparedStatement";
import type { PreparedStatement } from "./preparedStatement";
import { LIVE_STATES_PREDICATE, SELECTED_COLUMNS, toOwnershipTransferRequest } from "./ownershipTransfersSchema";
import type { OwnershipTransferRow } from "./ownershipTransfersSchema";

// Transfer statements share the frozen storage contract in ownershipTransfersSchema.
// The caller owns the transaction so ceremony state, command outcome and audit commit together.

// Earlier-schema migration and stopped-server repair handles can lack the transfer table.
// No live request can exist before it is installed; re-probe absence so the same handle notices later installation.
const ownershipTransfersTableExists = createTableExistenceProbe("account_ownership_transfers");

/**
 * The workflow revision one step on.
 *
 * Stored as an integer string to match the `membershipRevision` convention the rest of the account
 * contract already uses, so every revision a client sees has one wire shape. Parsed strictly: a
 * non-integer revision is corruption of the value that stops a stale command applying to a later
 * acceptance cycle, and continuing from a guess would defeat exactly that protection.
 */
export function nextOwnershipTransferRevision(revision: string): string {
  const current = /^\d+$/.test(revision) ? Number(revision) : NaN;
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new Error(
      `nextOwnershipTransferRevision: stored revision ${JSON.stringify(revision)} is not a non-negative integer — control table corrupted.`,
    );
  }
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `nextOwnershipTransferRevision: stored revision ${JSON.stringify(revision)} cannot advance safely — control table corrupted.`,
    );
  }
  return String(current + 1);
}

// The partial unique index guarantees at most one live request per company.
const liveRequestStatement = cachedStatement(
  `SELECT ${SELECTED_COLUMNS} FROM account_ownership_transfers WHERE accountId = ? AND ${LIVE_STATES_PREDICATE}`,
);

/** Returns the company’s unique live request, or null when none exists. */
export function readLiveRequest(db: Db, accountId: string): OwnershipTransferRequest | null {
  const row = liveRequestStatement(db).get(accountId) as OwnershipTransferRow | undefined;
  return row ? toOwnershipTransferRequest(row, "readLiveRequest") : null;
}

// Match both request ID and account ID so a foreign company’s request is indistinguishable from absence.
const requestByIdStatement = cachedStatement(
  `SELECT ${SELECTED_COLUMNS} FROM account_ownership_transfers WHERE id = ? AND accountId = ?`,
);

/** Returns one request only when its ID and account both match, regardless of lifecycle state. */
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
 * The most recent terminal request this principal took part in, or `null`.
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

// The partial unique index rejects competing initiations; a read-then-insert check cannot establish uniqueness.
const insertRequestStatement = cachedStatement(
  `INSERT INTO account_ownership_transfers
     (id, accountId, initiatorUserId, targetUserId, state, revision,
      createdAt, expiresAt, targetAcceptedAt, terminalAt, terminalReason)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

/** Inserts a transfer request inside the caller’s transaction.
 * @throws On duplicate live requests or other storage faults; the caller must roll back the command and audit together.
 */
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
  /** The state and revision the command was authorised against, the compare half of the CAS. */
  expectedState: OwnershipTransferState;
  expectedRevision: string;
  nextState: OwnershipTransferState;
  nextRevision: string;
  /** The three mutable columns are always written explicitly, never left to carry over: `withdraw`
   * must clear `targetAcceptedAt`, so an omitted column would silently keep a consent that was
   * taken back. */
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
 * The `WHERE` clause matches on `(id, accountId, state, revision)` and nothing else, in particular
 * never on membership values, because completion bumps those in the same transaction and a
 * membership-sensitive predicate would make the ceremony's own write unable to find its row.
 *
 * `false` means the row moved under the caller (a concurrent cancel, accept or invalidation), and
 * nothing was written. It is not an error here: the caller decides whether that is a conflict to
 * report or a race it loses quietly, and only the caller knows which command it was running.
 *
 * @throws Error if `expectedState` is terminal. Terminal rows are immutable, they are the durable
 * evidence a participant reads, so a caller asking to transition one is a programming fault, not
 * a lost race, and must fail loudly rather than return an ambiguous `false`.
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
  /** The ISO instant stamped as `terminalAt`, the value written, not a clock read here, so the
   * whole transaction that caused the invalidation shares one instant. */
  now: string;
}

interface TerminaliseForMemberInput extends TerminaliseForAccountInput {
  userId: string;
}

/**
 * Invalidate every live request of one company, returning the ids actually changed.
 *
 * The ids are the return value because the choke point that calls this holds no audit writer: the
 * calling port operation, inside the same transaction, emits one `ownership_transfer.invalidated`
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
 * so consent is bound eagerly: demotion, re-promotion, status change and removal each kill the
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

// Fixed cached predicates keep membership-triggered invalidation from compiling SQL on every write.
interface InvalidateScope {
  select: (db: Db) => PreparedStatement;
  update: (db: Db) => PreparedStatement;
}

function invalidateScope(predicate: string): InvalidateScope {
  const where = `accountId = ? AND ${LIVE_STATES_PREDICATE}${predicate}`;
  return {
    select: cachedStatement(`SELECT id, revision FROM account_ownership_transfers WHERE ${where}`),
    update: cachedStatement(
      `UPDATE account_ownership_transfers
          SET state = 'invalidated', terminalAt = ?, terminalReason = ?,
              revision = ?
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

// Read matching IDs and update in the caller’s transaction so the audit receives exactly the changed rows.
function invalidateLive({ db, now, reason, scope, parameters }: InvalidateLiveInput): string[] {
  if (!ownershipTransfersTableExists(db)) return [];
  const rows = scope.select(db).all(...parameters) as Array<{ id: string; revision: string }>;
  const [row] = rows;
  if (!row) return [];
  // The partial unique index on live states (ownershipTransfersSchema.ts) guarantees at most one
  // live row per account, so `row`'s revision is safe to write to every matched row. If that
  // index's scope ever widened, writing one row's successor to a second, higher-revision row
  // would silently move it backwards, fail loudly instead of doing that.
  if (rows.length > 1) {
    throw new Error(
      `invalidateLive: expected at most one live ownership-transfer row, found ${rows.length} — control table corrupted.`,
    );
  }
  const nextRevision = nextOwnershipTransferRevision(row.revision);
  scope.update(db).run(now, reason, nextRevision, ...parameters);
  return rows.map(({ id }) => id);
}

const deleteForAccountStatement = cachedStatement(`DELETE FROM account_ownership_transfers WHERE accountId = ?`);

/**
 * Delete every request row of one company, live and terminal alike.
 *
 * Workspace erasure calls this explicitly. There is no `accounts` cascade to rely on (this table
 * carries no FK by design), so without an explicit delete an erased company would leave behind rows
 * naming two of its principals. Erasure deletes rather than terminalising first: the delete runs in
 * the same transaction, so an invalidation written before it would never be visible to anyone, and
 * the audit trail of why the ceremony ended outlives the rows under audit policy.
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
 * Scoped to one company, like `pruneInvites`: this runs from a ceremony command, inside a mutation
 * holding that workspace's lock and audited against that workspace. An unscoped DELETE would let one
 * company's cancel remove another company's rows, outside any lock the caller holds, retention is a
 * per-company policy, not a housekeeping job that rides along with whoever writes next.
 *
 * @param accountId  The company whose history is being bounded. The workspace the caller's mutation
 * is locked and audited against.
 * @param now  The current instant in epoch milliseconds, arithmetic, not a stamp, which is why
 * this one takes a number where the terminalisers take the ISO instant they write.
 */
export function sweepExpiredHistory(db: Db, accountId: string, now: number): number {
  if (!Number.isFinite(now)) {
    throw new Error(`sweepExpiredHistory: ${JSON.stringify(now)} is not a usable current instant.`);
  }
  const cutoff = new Date(now - OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS).toISOString();
  const { changes } = sweepHistoryStatement(db).run(accountId, cutoff);
  return Number(changes);
}
