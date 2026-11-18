import { addDaysISO, daysInclusive } from '@capacitylens/shared/lib/dateMath';
import { generateRepeatingStartDates } from '@capacitylens/shared/lib/repeatingDates';
import { buildRepeatedTimeOffDrafts } from '@capacitylens/shared/lib/repeatingOccurrences';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import type { Allocation, ID, TimeOff } from '@capacitylens/shared/types/entities';
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import { DEFAULT_ACCOUNT_ID } from '@/test/fixtures';
import { queuePlanningPatch } from './queuePlanningPatch';

/** Queue a canonical group receipt for tests that exercise frontend batch command wiring. Later
 * occurrences follow the repeat pattern and keep the first occurrence's calendar span. */
export function queueAllocationGroupResponse(
  seriesId: ID | null = null,
  repeatAdvisory?: PlanningMutationSuccess['repeatAdvisory'],
): void {
  queuePlanningPatch(
    (execution) => {
      const intent = execution.intent;
      if (intent.operation !== 'allocation.createGroup') {
        throw new Error(`Expected allocation.createGroup, received ${intent.operation}.`);
      }
      const { allocation, repeat, occurrenceIds } = intent;
      const { startDates } = generateRepeatingStartDates(
        allocation.startDate,
        repeat.until,
        repeat.pattern,
      );
      const ids = [allocation.id, ...occurrenceIds];
      if (startDates.length !== ids.length) {
        throw new Error('The occurrence identities do not match the repeat.');
      }
      const span = daysInclusive(allocation.startDate, allocation.endDate);
      const createdAt = new Date().toISOString();
      return {
        removed: [],
        upserts: startDates.map((startDate, index) => ({
          entity: 'allocations',
          row: {
            ...NULLABLE_FIELDS.allocations,
            ...allocation,
            id: ids[index],
            startDate,
            endDate: addDaysISO(startDate, span - 1),
            companyId: DEFAULT_ACCOUNT_ID,
            createdAt,
            updatedAt: createdAt,
            seriesId,
          } as Allocation,
        })),
      };
    },
    repeatAdvisory ? { repeatAdvisory } : {},
  );
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

/** Queue the repeat as the canonical set of independent time-off rows the server would write. */
export function queueTimeOffRepeatResponse(): void {
  queuePlanningPatch((execution: PlanningExecution) => {
    const intent = execution.intent;
    if (intent.operation !== 'timeOff.repeat') {
      throw new Error(`Expected timeOff.repeat, received ${intent.operation}.`);
    }
    const { timeOff, repeat, occurrenceIds } = intent;
    const { drafts } = buildRepeatedTimeOffDrafts(timeOff, repeat.until, repeat.pattern);
    const ids = [timeOff.id, ...occurrenceIds];
    if (drafts.length !== ids.length) {
      throw new Error('The occurrence identities do not match the repeat.');
    }
    const createdAt = new Date().toISOString();
    return {
      removed: [],
      upserts: drafts.map((entry, index) => ({
        entity: 'timeOff',
        row: {
          ...NULLABLE_FIELDS.timeOff,
          ...entry,
          id: String(ids[index]),
          companyId: DEFAULT_ACCOUNT_ID,
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
