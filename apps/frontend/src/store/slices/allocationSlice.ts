import type { StateCreator, StoreApi } from 'zustand';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import {
  assertAllocationWithinResourceAvailability,
  assertDateRange,
} from '@capacitylens/shared/domain/mutations';
import { assertAllocationPlacement } from '@capacitylens/shared/domain/placement';
import { newId } from '@capacitylens/shared/lib/id';
import { MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays';
import type { Allocation, AppData, ID } from '@capacitylens/shared/types/entities';
import {
  buildAllocationCreate,
  buildAllocationDuplicate,
  buildAllocationUpdate,
} from '@/data/planning/planningCommands';
import type { PlanningCommand } from '@/data/planning/planningCommands';
import type { AllocationSaveAdvisory } from '@/store/StoreEntityActions';
import type { StoreInternals } from '@/store/storeInternal';
import type { Draft, StoreState } from '@/store/types';

type AllocationSlice = Pick<
  StoreState,
  | 'addAllocation'
  | 'addRepeatedAllocation'
  | 'duplicateAllocation'
  | 'updateAllocation'
  | 'deleteAllocation'
  | 'deleteAllocationSeriesFrom'
>;

/** Store capabilities used by allocation actions. */
export type AllocationSliceInternals = Pick<
  StoreInternals,
  'requireAccount' | 'blockedByViewer' | 'assertAllocation' | 'resolveOwnedRow' | 'applyPatch'
>;

function assertSuppliedHours(hours: number): void {
  if (!Number.isFinite(hours) || hours < 0 || hours > MAX_HOURS_PER_DAY) {
    throw new Error(`Hours per day must be a finite number between 0 and ${MAX_HOURS_PER_DAY}.`);
  }
}

function validateNewAllocations(
  internals: AllocationSliceInternals,
  data: AppData,
  companyId: ID,
  inputs: readonly Draft<Allocation>[],
): void {
  const account = data.accounts.find((candidate) => candidate.id === companyId);
  const accountWorkingDays = normalizeAccountWorkingDays(
    account?.workingDays,
    account?.weekStartsOn ?? 1,
  );
  for (const input of inputs) {
    const allocation = { ...NULLABLE_FIELDS.allocations, ...input, companyId };
    internals.assertAllocation(
      data,
      companyId,
      allocation.resourceId,
      allocation.activityId,
      allocation.hoursPerDay,
      allocation.projectId,
    );
    assertDateRange(allocation.startDate, allocation.endDate);
    const resource = data.resources.find(
      (candidate) => candidate.companyId === companyId && candidate.id === allocation.resourceId,
    );
    if (resource) {
      assertAllocationWithinResourceAvailability({ allocation, resource, accountWorkingDays });
    }
  }
}

function assertAvailabilityAfterPlacementChange(
  data: AppData,
  effective: Allocation,
  existing: Allocation,
): void {
  const resource = data.resources.find(
    (candidate) =>
      candidate.companyId === existing.companyId && candidate.id === effective.resourceId,
  );
  const account = data.accounts.find((candidate) => candidate.id === existing.companyId);
  const accountWorkingDays = normalizeAccountWorkingDays(
    account?.workingDays,
    account?.weekStartsOn ?? 1,
  );
  if (resource) {
    assertAllocationPlacement({ allocation: effective, existing, resource, accountWorkingDays });
  }
}

function requireCommand(command: PlanningCommand | null): PlanningCommand {
  if (!command) throw new Error('The allocation could not be prepared for saving.');
  return command;
}

function getCreatedRows(get: StoreApi<StoreState>['getState'], ids: readonly ID[]): Allocation[] {
  const rows = ids.map((id) => get().data.allocations.find((allocation) => allocation.id === id));
  if (rows.some((row) => !row)) throw new Error('Allocation creation produced no row.');
  return rows as Allocation[];
}

function readSaveAdvisory(receipt: PlanningMutationSuccess | undefined): AllocationSaveAdvisory {
  return {
    ...(receipt?.advisory ? { advisory: receipt.advisory } : {}),
    ...(receipt?.repeatAdvisory ? { repeatAdvisory: receipt.repeatAdvisory } : {}),
  };
}

/** Create allocation actions backed by the planning cache controller. */
export function createAllocationSlice(
  internals: AllocationSliceInternals,
): StateCreator<StoreState, [], [], AllocationSlice> {
  return (_set, get) => {
    const { requireAccount, blockedByViewer, assertAllocation, resolveOwnedRow, applyPatch } =
      internals;
    const send = (command: PlanningCommand) => get().sendPlanningCommand(command);
    const prepareNew = (inputs: readonly Draft<Allocation>[]) => {
      if (inputs.length === 0) throw new Error('At least one allocation is required.');
      const companyId = requireAccount();
      if (blockedByViewer()) return null;
      const data = get().data;
      for (const input of inputs) assertSuppliedHours(input.hoursPerDay);
      validateNewAllocations(internals, data, companyId, inputs);
      // Row ids are minted here, on the typed command path; the server assigns any series id.
      return { companyId, data, drafts: inputs.map((fields) => ({ id: newId(), fields })) };
    };

    return {
      addAllocation: async (input) => {
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: 'blocked' };
        const draft = prepared.drafts[0] as (typeof prepared.drafts)[number];
        const receipt = await send(
          requireCommand(buildAllocationCreate({ ...prepared, args: draft })),
        );
        const [created] = getCreatedRows(get, [draft.id]);
        if (!created) throw new Error('Allocation creation produced no row.');
        return { kind: 'created', value: created, ...readSaveAdvisory(receipt) };
      },
      addRepeatedAllocation: async (input, repeat, count) => {
        if (!Number.isSafeInteger(count) || count < 2) {
          throw new Error('A repeat needs at least two occurrences.');
        }
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: 'blocked' };
        const draft = prepared.drafts[0] as (typeof prepared.drafts)[number];
        const command = requireCommand(buildAllocationCreate({ ...prepared, args: draft }));
        if (command.intent.operation !== 'allocation.create') {
          throw new Error('Unexpected allocation command.');
        }
        // Later occurrence ids are minted here too, so every created row can be returned by id.
        const occurrenceIds = Array.from({ length: count - 1 }, () => newId());
        const ids = [draft.id, ...occurrenceIds];
        const receipt = await send({
          intent: {
            operation: 'allocation.createGroup',
            allocation: command.intent.allocation,
            repeat,
            occurrenceIds,
          },
        });
        return { kind: 'created', value: getCreatedRows(get, ids), ...readSaveAdvisory(receipt) };
      },
      duplicateAllocation: async (sourceId, input) => {
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: 'blocked' };
        const draft = prepared.drafts[0] as (typeof prepared.drafts)[number];
        const original = resolveOwnedRow(prepared.data, 'allocations', sourceId);
        if (!original) throw new Error('The allocation to duplicate no longer exists.');
        const receipt = await send(
          requireCommand(
            buildAllocationDuplicate({
              ...prepared,
              original,
              args: { sourceId, id: draft.id, fields: draft.fields },
            }),
          ),
        );
        const [created] = getCreatedRows(get, [draft.id]);
        if (!created) throw new Error('Allocation creation produced no row.');
        return { kind: 'created', value: created, ...readSaveAdvisory(receipt) };
      },
      updateAllocation: async (id, patch) => {
        const data = get().data;
        const existing = resolveOwnedRow(data, 'allocations', id);
        if (!existing || blockedByViewer()) return false;
        const effective = applyPatch(existing, patch);
        assertSuppliedHours(effective.hoursPerDay);
        // Validate the merged row so unrelated edits cannot preserve invalid external-resource
        // load that the server would reject.
        assertAllocation(
          data,
          existing.companyId,
          effective.resourceId,
          effective.activityId,
          effective.hoursPerDay,
          effective.projectId,
          existing,
        );
        assertDateRange(effective.startDate, effective.endDate);
        assertAvailabilityAfterPlacementChange(data, effective, existing);
        const command = buildAllocationUpdate({
          data,
          companyId: existing.companyId,
          original: existing,
          args: { id, changes: patch },
        });
        if (!command) return false;
        return readSaveAdvisory(await send(command));
      },
      deleteAllocation: async (id) => {
        if (blockedByViewer() || !resolveOwnedRow(get().data, 'allocations', id)) return;
        await send({ intent: { operation: 'allocation.delete', id } });
      },
      deleteAllocationSeriesFrom: async (id) => {
        if (blockedByViewer()) return;
        const target = resolveOwnedRow(get().data, 'allocations', id);
        if (!target) return;
        if (!target.seriesId) throw new Error('This allocation is not part of a repeat series.');
        const { companyId, seriesId, startDate } = target;
        // One typed write deletes the whole tail, so a single Undo restores it.
        const ids = get()
          .data.allocations.filter(
            (allocation) =>
              allocation.companyId === companyId &&
              allocation.seriesId === seriesId &&
              allocation.startDate >= startDate,
          )
          .map((allocation) => allocation.id);
        await send({ intent: { operation: 'allocation.deleteGroup', ids } });
      },
    };
  };
}
