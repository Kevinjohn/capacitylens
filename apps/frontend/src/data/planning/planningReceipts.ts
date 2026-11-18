import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningSnapshot } from './planningCacheTypes';

// Shape and scope checks for server reads and receipts.

export function isValidSnapshot(snapshot: unknown): snapshot is PlanningSnapshot {
  if (!isRecord(snapshot) || !isRecord(snapshot.data)) return false;
  const data = snapshot.data;
  return (
    Number.isSafeInteger(snapshot.revision) &&
    typeof snapshot.revision === 'number' &&
    snapshot.revision >= 0 &&
    Array.isArray(data.accounts) &&
    data.accounts.every(isRecord) &&
    SCOPED_KEYS.every((key) => Array.isArray(data[key])) &&
    SCOPED_KEYS.every((key) => (data[key] as unknown[]).every(isRecord)) &&
    (snapshot.accessKey === undefined || typeof snapshot.accessKey === 'string') &&
    isValidISODate(snapshot.today) &&
    typeof snapshot.canWrite === 'boolean' &&
    (snapshot.history === undefined ||
      (isRecord(snapshot.history) &&
        typeof snapshot.history.canUndo === 'boolean' &&
        typeof snapshot.history.canRedo === 'boolean'))
  );
}

export function isSnapshotForCompany(snapshot: PlanningSnapshot, companyId: string): boolean {
  return (
    snapshot.data.accounts.length === 1 &&
    snapshot.data.accounts.every((account) => isRecord(account) && account.id === companyId) &&
    SCOPED_KEYS.every((key) =>
      snapshot.data[key].every((row) => isRecord(row) && row.companyId === companyId),
    )
  );
}

export function isValidReceipt(
  receipt: unknown,
  execution: Pick<PlanningExecution, 'mutationId' | 'baseRevision'>,
): receipt is PlanningMutationSuccess {
  if (!isRecord(receipt) || !isRecord(receipt.restoration)) return false;
  const restoration = receipt.restoration;
  const validRestoration =
    (restoration.consumedGroupId === null || typeof restoration.consumedGroupId === 'string') &&
    (restoration.replacementGroupId === null || typeof restoration.replacementGroupId === 'string');
  return (
    receipt.status === 'committed' &&
    receipt.mutationId === execution.mutationId &&
    Number.isSafeInteger(receipt.revision) &&
    typeof receipt.revision === 'number' &&
    receipt.revision === execution.baseRevision + 1 &&
    validRestoration
  );
}
