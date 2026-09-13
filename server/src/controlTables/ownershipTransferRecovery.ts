import type { Db } from "../db";

export interface OwnershipTransferRecoveryRow {
  id: string;
  accountId: string;
  initiatorUserId: string;
  targetUserId: string;
  state: string;
  revision: string;
}

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
