import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import type { Allocation, ID, TimeOff } from '@capacitylens/shared/types/entities';
import type { PlanningExecution } from '@/api/planningContracts';
import { DEFAULT_ACCOUNT_ID } from '@/test/fixtures';
import { queuePlanningPatch } from './queuePlanningPatch';

/** Queue a canonical group receipt for tests that exercise frontend batch command wiring. */
export function queueAllocationGroupResponse(seriesId: ID | null = null): void {
  queuePlanningPatch((execution) => {
    const intent = execution.intent;
    if (intent.operation !== 'allocation.createGroup') {
      throw new Error(`Expected allocation.createGroup, received ${intent.operation}.`);
    }
    const createdAt = new Date().toISOString();
    return {
      removed: [],
      upserts: intent.allocations.map((allocation) => ({
        entity: 'allocations',
        row: {
          ...NULLABLE_FIELDS.allocations,
          ...allocation,
          accountId: DEFAULT_ACCOUNT_ID,
          createdAt,
          updatedAt: createdAt,
          seriesId,
        } as Allocation,
      })),
    };
  });
}

/** Queue a deletion receipt for a test-owned set of rows. */
export function queueAllocationDeleteGroupResponse(
  ids: readonly ID[],
  restorationGroupId: ID,
): void {
  queuePlanningPatch(
    () => ({
      upserts: [],
      removed: ids.map((id) => ({ entity: 'allocations', id })),
    }),
    { replacementGroupId: restorationGroupId },
  );
}

/** Queue restoration rows when a test exercises typed undo/redo after a group deletion. */
export function queueAllocationRestoreResponse(
  allocations: readonly Allocation[],
  restorationGroupId: ID,
): void {
  queuePlanningPatch(
    () => ({
      removed: [],
      upserts: allocations.map((row) => ({ entity: 'allocations', row })),
    }),
    { consumedGroupId: restorationGroupId },
  );
}

/** Queue the frontend batch request as a canonical set of independent time-off rows. */
export function queueTimeOffRepeatResponse(): void {
  queuePlanningPatch((execution: PlanningExecution) => {
    const intent = execution.intent;
    if (intent.operation !== 'timeOff.repeat') {
      throw new Error(`Expected timeOff.repeat, received ${intent.operation}.`);
    }
    const createdAt = new Date().toISOString();
    return {
      removed: [],
      upserts: intent.entries.map((entry) => ({
        entity: 'timeOff',
        row: {
          ...NULLABLE_FIELDS.timeOff,
          ...entry,
          id: String(entry.id),
          accountId: DEFAULT_ACCOUNT_ID,
          createdAt,
          updatedAt: createdAt,
        } as TimeOff,
      })),
    };
  });
}

/** Queue the deletion receipt and server-issued handle for a time-off batch. */
export function queueTimeOffDeleteGroupResponse(ids: readonly ID[], restorationGroupId: ID): void {
  queuePlanningPatch(
    () => ({
      upserts: [],
      removed: ids.map((id) => ({ entity: 'timeOff', id })),
    }),
    { replacementGroupId: restorationGroupId },
  );
}

/** Queue restored time-off rows for a test-owned restoration flow. */
export function queueTimeOffRestoreResponse(
  rows: readonly TimeOff[],
  restorationGroupId: ID,
): void {
  queuePlanningPatch(
    () => ({
      removed: [],
      upserts: rows.map((row) => ({ entity: 'timeOff', row })),
    }),
    { consumedGroupId: restorationGroupId },
  );
}
