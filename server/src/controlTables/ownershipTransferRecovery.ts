import type { Db } from "../db";

/**
 * Carries the persisted participants, state, and revision needed to recover a transfer safely.
 */
export interface OwnershipTransferRecoveryRow {
  id: string;
  accountId: string;
  initiatorUserId: string;
  targetUserId: string;
  state: string;
  revision: string;
}

/**
 * Loads a transfer request only when both its ID and account match.
 */
export function readOwnershipTransferRecoveryRow(
  db: Db,
  accountId: string,
  requestId: string,
): OwnershipTransferRecoveryRow | null {
  return (
    (db
      .prepare(
        `SELECT id, accountId, initiatorUserId, targetUserId, state, revision
           FROM account_ownership_transfers
          WHERE id = ? AND accountId = ?`,
      )
      .get(requestId, accountId) as OwnershipTransferRecoveryRow | undefined) ?? null
  );
}

interface CancelRecoveryRowInput {
  accountId: string;
  requestId: string;
  state: string;
  initiatorUserId: string;
  targetUserId: string;
  revision: string;
  terminalAt: string;
}

/**
 * Cancels the request only if its participants, state, and revision still match the inspected row.
 */
export function cancelOwnershipTransferRecoveryRow(db: Db, input: CancelRecoveryRowInput): boolean {
  const result = db
    .prepare(
      `UPDATE account_ownership_transfers
          SET state = 'cancelled', terminalAt = ?, terminalReason = 'owner_cancelled'
        WHERE id = ? AND accountId = ? AND state = ?
          AND initiatorUserId = ? AND targetUserId = ? AND revision = ?`,
    )
    .run(
      input.terminalAt,
      input.requestId,
      input.accountId,
      input.state,
      input.initiatorUserId,
      input.targetUserId,
      input.revision,
    );
  return result.changes === 1;
}
