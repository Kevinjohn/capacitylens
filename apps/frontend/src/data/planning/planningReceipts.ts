import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningSnapshot } from './planningCacheTypes';

// Shape and scope checks for server reads and receipts.

function isValidAccess(access: unknown): boolean {
  return (
    isRecord(access) &&
    typeof access.actorId === 'string' &&
    typeof access.effectiveActorId === 'string' &&
    typeof access.role === 'string' &&
    typeof access.canWrite === 'boolean' &&
    typeof access.canSeePrivateNames === 'boolean' &&
    typeof access.canSeeTimeOffNote === 'boolean'
  );
}

function isValidContent(snapshot: Record<string, unknown>): boolean {
  if (snapshot.content === 'unchanged') return !('data' in snapshot);
  if (snapshot.content !== undefined && snapshot.content !== 'full') return false;
  const data = snapshot.data;
  return (
    isRecord(data) &&
    Array.isArray(data.companies) &&
    data.companies.every(isRecord) &&
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
    isValidContent(snapshot) &&
    isValidAccess(snapshot.access) &&
    isValidISODate(snapshot.today) &&
    (snapshot.history === undefined ||
      (isRecord(snapshot.history) &&
        typeof snapshot.history.canUndo === 'boolean' &&
        typeof snapshot.history.canRedo === 'boolean'))
  );
}

export function isSnapshotForCompany(snapshot: PlanningSnapshot, companyId: string): boolean {
  if (snapshot.content === 'unchanged') return true;
  return (
    snapshot.data.companies.length === 1 &&
    snapshot.data.companies.every((company) => isRecord(company) && company.id === companyId) &&
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
    validRestoration &&
    isRecord(receipt.changes) &&
    Array.isArray(receipt.changes.upserts) &&
    Array.isArray(receipt.changes.removed)
  );
}
