import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays';
import {
  applyCapacityMode,
  buildCapacityAdvisory,
  listTimeOffApplyingTo,
} from '@capacitylens/shared/lib/capacity';
import { buildRepeatingAllocationAdvisory } from '@capacitylens/shared/lib/capacity/repeatAdvisory';
import { effectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { carriesHourlyLoad, isCapacityTracked } from '@capacitylens/shared/types/entities';
import type { Allocation, AppData } from '@capacitylens/shared/types/entities';
import type { PlanningIntent, PlanningMutationSuccess } from '#validators/planning/contracts';

/** The capacity part of an allocation save reply. */
export type SaveAdvisory = Pick<PlanningMutationSuccess, 'advisory' | 'repeatAdvisory'>;

function listWrittenAllocationIds(intent: PlanningIntent): string[] {
  if (intent.operation === 'allocation.create') return [intent.allocation.id];
  if (intent.operation === 'allocation.createGroup') {
    return [intent.allocation.id, ...intent.occurrenceIds];
  }
  if (intent.operation === 'allocation.update') return [intent.id];
  if (intent.operation === 'allocation.duplicate') return [intent.occurrence.id];
  return [];
}

/**
 * Capacity advisory for the allocation rows an allocation write committed, measured against the
 * company's active after-state with the shared capacity rules. Other intents carry none.
 */
export function buildSaveAdvisory(
  intent: PlanningIntent,
  after: AppData,
  companyId: string
): SaveAdvisory {
  const ids = listWrittenAllocationIds(intent);
  const written = ids
    .map((id) => after.allocations.find((row) => row.id === id))
    .filter((row): row is Allocation => row !== undefined);
  if (written.length === 0) return {};
  const [first] = written;
  const account = after.accounts.find((row) => row.id === companyId);
  const resource = after.resources.find((row) => row.id === first.resourceId);
  if (!account || !resource) return {};
  const blocksMode = !carriesHourlyLoad(account.schedulingMode ?? 'hourly');
  const writtenIds = new Set(ids);
  const others = applyCapacityMode({
    allocations: after.allocations.filter(
      (row) => row.resourceId === resource.id && !writtenIds.has(row.id)
    ),
    blocksMode,
  });
  const proposals = applyCapacityMode({ allocations: written, blocksMode });
  const [proposal] = proposals;
  const effectiveWeek = effectiveWorkingWeek(
    resource,
    normalizeAccountWorkingDays(account.workingDays, account.weekStartsOn === 0 ? 0 : 1)
  );
  const timeOff = listTimeOffApplyingTo(resource.id, after.timeOff);
  if (intent.operation === 'allocation.createGroup') {
    return {
      repeatAdvisory: buildRepeatingAllocationAdvisory({
        resource,
        existingLoad: others,
        timeOff,
        proposedDrafts: proposals,
        effectiveWeek,
        closures: after.closures,
      }),
    };
  }
  return {
    advisory: isCapacityTracked(resource)
      ? buildCapacityAdvisory({
          resource,
          proposal,
          otherAllocations: others,
          timeOff,
          effectiveWeek,
          closures: after.closures,
        })
      : { overDays: 0, timeOffDays: 0 },
  };
}
