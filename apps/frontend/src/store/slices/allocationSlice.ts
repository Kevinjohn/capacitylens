import type { StateCreator, StoreApi } from 'zustand';
import type { PlanningIntent } from '@/api/planningContracts';
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

// A delete's Undo uses the server's restoration handle, which the controller fills from the receipt.
const RESTORE_FROM_RECEIPT: PlanningIntent = {
  operation: 'planning.restoreGroup',
  restorationGroupId: '',
};

function assertSuppliedHours(hours: number): void {
  if (!Number.isFinite(hours) || hours < 0 || hours > MAX_HOURS_PER_DAY) {
    throw new Error(`Hours per day must be a finite number between 0 and ${MAX_HOURS_PER_DAY}.`);
  }
}

function validateNewAllocations(
  internals: AllocationSliceInternals,
  data: AppData,
  accountId: ID,
  inputs: readonly Draft<Allocation>[],
): void {
  const account = data.accounts.find((candidate) => candidate.id === accountId);
  const accountWorkingDays = normalizeAccountWorkingDays(
    account?.workingDays,
    account?.weekStartsOn ?? 1,
  );
  for (const input of inputs) {
    const allocation = { ...NULLABLE_FIELDS.allocations, ...input, accountId };
    internals.assertAllocation(
      data,
      accountId,
      allocation.resourceId,
      allocation.activityId,
      allocation.hoursPerDay,
      allocation.projectId,
    );
    assertDateRange(allocation.startDate, allocation.endDate);
    const resource = data.resources.find(
      (candidate) => candidate.accountId === accountId && candidate.id === allocation.resourceId,
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
      candidate.accountId === existing.accountId && candidate.id === effective.resourceId,
  );
  const account = data.accounts.find((candidate) => candidate.id === existing.accountId);
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

function createdRows(get: StoreApi<StoreState>['getState'], ids: readonly ID[]): Allocation[] {
  const rows = ids.map((id) => get().data.allocations.find((allocation) => allocation.id === id));
  if (rows.some((row) => !row)) throw new Error('Allocation creation produced no row.');
  return rows as Allocation[];
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
      const accountId = requireAccount();
      if (blockedByViewer()) return null;
      const data = get().data;
      for (const input of inputs) assertSuppliedHours(input.hoursPerDay);
      validateNewAllocations(internals, data, accountId, inputs);
      // Row ids are minted here, on the typed command path; the server assigns any series id.
      return { accountId, data, drafts: inputs.map((fields) => ({ id: newId(), fields })) };
    };

    return {
      addAllocation: async (input) => {
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: 'blocked' };
        const draft = prepared.drafts[0] as (typeof prepared.drafts)[number];
        await send(requireCommand(buildAllocationCreate({ ...prepared, args: draft })));
        const [created] = createdRows(get, [draft.id]);
        if (!created) throw new Error('Allocation creation produced no row.');
        return { kind: 'created', value: created };
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
        // Later occurrence ids are minted here too, so Undo can delete the whole set by id.
        const occurrenceIds = Array.from({ length: count - 1 }, () => newId());
        const ids = [draft.id, ...occurrenceIds];
        await send({
          intent: {
            operation: 'allocation.createGroup',
            allocation: command.intent.allocation,
            repeat,
            occurrenceIds,
          },
          inverse: { operation: 'allocation.deleteGroup', ids },
        });
        return { kind: 'created', value: createdRows(get, ids) };
      },
      duplicateAllocation: async (sourceId, input) => {
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: 'blocked' };
        const draft = prepared.drafts[0] as (typeof prepared.drafts)[number];
        const original = resolveOwnedRow(prepared.data, 'allocations', sourceId);
        if (!original) throw new Error('The allocation to duplicate no longer exists.');
        await send(
          requireCommand(
            buildAllocationDuplicate({
              ...prepared,
              original,
              args: { sourceId, id: draft.id, fields: draft.fields },
            }),
          ),
        );
        const [created] = createdRows(get, [draft.id]);
        if (!created) throw new Error('Allocation creation produced no row.');
        return { kind: 'created', value: created };
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
          existing.accountId,
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
          accountId: existing.accountId,
          original: existing,
          args: { id, changes: patch },
        });
        if (!command) return false;
        await send(command);
        return true;
      },
      deleteAllocation: async (id) => {
        if (blockedByViewer() || !resolveOwnedRow(get().data, 'allocations', id)) return;
        await send({
          intent: { operation: 'allocation.delete', id },
          inverse: RESTORE_FROM_RECEIPT,
        });
      },
      deleteAllocationSeriesFrom: async (id) => {
        if (blockedByViewer()) return;
        const target = resolveOwnedRow(get().data, 'allocations', id);
        if (!target) return;
        if (!target.seriesId) throw new Error('This allocation is not part of a repeat series.');
        const { accountId, seriesId, startDate } = target;
        // One typed write deletes the whole tail, so a single Undo restores it.
        const ids = get()
          .data.allocations.filter(
            (allocation) =>
              allocation.accountId === accountId &&
              allocation.seriesId === seriesId &&
              allocation.startDate >= startDate,
          )
          .map((allocation) => allocation.id);
        await send({
          intent: { operation: 'allocation.deleteGroup', ids },
          inverse: RESTORE_FROM_RECEIPT,
        });
      },
    };
  };
}
