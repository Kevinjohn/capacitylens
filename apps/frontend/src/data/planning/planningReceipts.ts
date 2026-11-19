import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningSnapshot } from './planningCacheTypes';

// Shape and scope checks for server reads and receipts.

function isValidAuthority(authority: unknown): boolean {
  return (
    isRecord(authority) &&
    typeof authority.actorId === 'string' &&
    typeof authority.effectiveActorId === 'string' &&
    typeof authority.role === 'string' &&
    typeof authority.canWrite === 'boolean' &&
    typeof authority.canSeePrivateNames === 'boolean' &&
    typeof authority.canSeeTimeOffNote === 'boolean'
  );
}

function isValidSlice(snapshot: Record<string, unknown>): boolean {
  if (snapshot.slice === 'unchanged') return !('data' in snapshot);
  if (snapshot.slice !== undefined && snapshot.slice !== 'full') return false;
  const data = snapshot.data;
  return (
    isRecord(data) &&
    Array.isArray(data.accounts) &&
    data.accounts.every(isRecord) &&
    SCOPED_KEYS.every((key) => Array.isArray(data[key])) &&
    SCOPED_KEYS.every((key) => (data[key] as unknown[]).every(isRecord))
  );
}

export function isValidSnapshot(snapshot: unknown): snapshot is PlanningSnapshot {
  if (!isRecord(snapshot)) return false;
  return (
    Number.isSafeInteger(snapshot.revision) &&
    typeof snapshot.revision === 'number' &&
    snapshot.revision >= 0 &&
    isValidSlice(snapshot) &&
    isValidAuthority(snapshot.authority) &&
    isValidISODate(snapshot.today) &&
    (snapshot.history === undefined ||
      (isRecord(snapshot.history) &&
        typeof snapshot.history.canUndo === 'boolean' &&
        typeof snapshot.history.canRedo === 'boolean'))
  );
}

export function isSnapshotForCompany(snapshot: PlanningSnapshot, companyId: string): boolean {
  if (snapshot.slice === 'unchanged') return true;
  return (
    snapshot.data.accounts.length === 1 &&
    snapshot.data.accounts.every((company) => isRecord(company) && company.id === companyId) &&
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
