import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities';
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningSnapshot } from './planningCacheController';

// Shape and scope checks for server reads and receipts, and applying a receipt's patch projection.

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
    typeof snapshot.canWrite === 'boolean'
  );
}

export function isSnapshotForCompany(snapshot: PlanningSnapshot, companyId: string): boolean {
  return (
    snapshot.data.accounts.length === 1 &&
    snapshot.data.accounts.every((account) => isRecord(account) && account.id === companyId) &&
    SCOPED_KEYS.every((key) =>
      snapshot.data[key].every((row) => isRecord(row) && row.accountId === companyId),
    )
  );
}

export function isProjectionForCompany(
  receipt: PlanningMutationSuccess,
  companyId: string,
): boolean {
  if (receipt.projection.mode !== 'patch') return true;
  return receipt.projection.changed.upserts.every(({ entity, row }) =>
    entity === 'accounts'
      ? row.id === companyId
      : 'accountId' in row && row.accountId === companyId,
  );
}

export function applyProjection(data: AppData, success: PlanningMutationSuccess): AppData {
  if (success.projection.mode !== 'patch') return data;
  const next: AppData = { ...data };
  const mutable = next as unknown as Record<AppDataKey, Array<{ id: string }>>;
  const changedKeys = new Set<AppDataKey>();
  for (const item of success.projection.changed.upserts) changedKeys.add(item.entity);
  for (const item of success.projection.changed.removed) changedKeys.add(item.entity);
  for (const key of changedKeys) {
    const rows = [...data[key]] as unknown as Array<{ id: string }>;
    const changes = success.projection.changed;
    const removedIds = new Set(
      changes.removed.filter((item) => item.entity === key).map((item) => item.id),
    );
    const upserts = changes.upserts.filter((item) => item.entity === key) as unknown as Array<{
      entity: AppDataKey;
      row: { id: string };
    }>;
    const byId = new Map(rows.filter((row) => !removedIds.has(row.id)).map((row) => [row.id, row]));
    for (const item of upserts) byId.set(item.row.id, item.row);
    mutable[key] = [...byId.values()];
  }
  return next;
}

export function isValidReceipt(
  receipt: unknown,
  execution: PlanningExecution,
): receipt is PlanningMutationSuccess {
  if (!isRecord(receipt) || !isRecord(receipt.restoration) || !isRecord(receipt.projection)) {
    return false;
  }
  const restoration = receipt.restoration;
  const projection = receipt.projection;
  const changed = projection.changed;
  const validRestoration =
    (restoration.consumedGroupId === null || typeof restoration.consumedGroupId === 'string') &&
    (restoration.replacementGroupId === null || typeof restoration.replacementGroupId === 'string');
  const validProjection =
    (projection.mode === 'refetch' && projection.history === 'clear') ||
    (projection.mode === 'patch' &&
      projection.history === 'retain' &&
      isRecord(changed) &&
      Array.isArray(changed.upserts) &&
      Array.isArray(changed.removed));
  return (
    receipt.status === 'committed' &&
    receipt.mutationId === execution.mutationId &&
    Number.isSafeInteger(receipt.revision) &&
    typeof receipt.revision === 'number' &&
    receipt.revision === execution.baseRevision + 1 &&
    validRestoration &&
    validProjection
  );
}
