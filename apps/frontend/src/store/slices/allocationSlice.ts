import type { StateCreator, StoreApi } from 'zustand';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { assertDateRange } from '@capacitylens/shared/domain/mutations';
import { createId } from '@capacitylens/shared/lib/id';
import { MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities';
import type { Allocation, ID } from '@capacitylens/shared/types/entities';
import {
  buildAllocationCreate,
  buildAllocationDuplicate,
  buildAllocationUpdate,
} from '@/data/planning/planningIntents';
import type { PlanningIntentRequest } from '@/data/planning/planningIntents';
import type { AllocationSaveAdvisory } from '@/store/StoreEntityActions';
import type { StoreInternals } from '@/store/storeInternal';
import type { Draft, StoreState } from '@/store/types';

type AllocationSlice = Pick<
  StoreState,
  | 'addAllocation'
  | 'addRepeatedAllocation'
  | 'duplicateAllocation'
  | 'updateAllocation'
  | 'reassignAllocation'
  | 'deleteAllocation'
  | 'deleteAllocationSeriesFrom'
>;

/** Store dependencies used by allocation actions. */
export type AllocationSliceInternals = Pick<
  StoreInternals,
  'requireCompany' | 'isBlockedByViewer' | 'resolveOwnedRow' | 'applyPatch'
>;

function assertSuppliedHours(hours: number): void {
  if (!Number.isFinite(hours) || hours < 0 || hours > MAX_HOURS_PER_DAY) {
    throw new Error(`Hours per day must be a finite number between 0 and ${MAX_HOURS_PER_DAY}.`);
  }
}

function requireIntentRequest(intentRequest: PlanningIntentRequest | null): PlanningIntentRequest {
  if (!intentRequest) throw new Error('The allocation could not be prepared for saving.');
  return intentRequest;
}

function requireCreatedRows(
  get: StoreApi<StoreState>['getState'],
  ids: readonly ID[],
): Allocation[] {
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

/** Create allocation actions backed by the planning cache. */
export function createAllocationSlice(
  internals: AllocationSliceInternals,
): StateCreator<StoreState, [], [], AllocationSlice> {
  return (_set, get) => {
    const { requireCompany, isBlockedByViewer, resolveOwnedRow, applyPatch } = internals;
    const send = (intentRequest: PlanningIntentRequest) => get().sendPlanningIntent(intentRequest);
    const prepareNew = (inputs: readonly Draft<Allocation>[]) => {
      if (inputs.length === 0) throw new Error('At least one allocation is required.');
      const companyId = requireCompany();
      if (isBlockedByViewer()) return null;
      const data = get().data;
      for (const input of inputs) assertSuppliedHours(input.hoursPerDay);
      for (const input of inputs) assertDateRange(input.startDate, input.endDate);
      // Row ids are minted here, on the typed intent path; the server assigns any series id.
      return { companyId, data, drafts: inputs.map((fields) => ({ id: createId(), fields })) };
    };

    return {
      addAllocation: async (input) => {
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: 'blocked' };
        const draft = prepared.drafts[0] as (typeof prepared.drafts)[number];
        const receipt = await send(
          requireIntentRequest(buildAllocationCreate({ ...prepared, args: draft })),
        );
        const [created] = requireCreatedRows(get, [draft.id]);
        if (!created) throw new Error('Allocation creation produced no row.');
        return { kind: 'created', value: created, ...readSaveAdvisory(receipt) };
      },
      addRepeatedAllocation: async (input, repeat) => {
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: 'blocked' };
        const draft = prepared.drafts[0] as (typeof prepared.drafts)[number];
        const intentRequest = requireIntentRequest(
          buildAllocationCreate({ ...prepared, args: draft }),
        );
        if (intentRequest.intent.operation !== 'allocation.create') {
          throw new Error('Unexpected allocation intent.');
        }
        // The server expands the pattern and mints the later ids; its receipt names every row.
        const receipt = await send({
          intent: {
            operation: 'allocation.createGroup',
            allocation: intentRequest.intent.allocation,
            repeat,
          },
        });
        const later = (receipt?.changes.upserts ?? [])
          .flatMap((change) => (change.entity === 'allocations' ? [change.row] : []))
          .filter((row) => row.id !== draft.id)
          .sort((left, right) => left.startDate.localeCompare(right.startDate));
        return {
          kind: 'created',
          value: requireCreatedRows(get, [draft.id, ...later.map((row) => row.id)]),
          ...readSaveAdvisory(receipt),
        };
      },
      duplicateAllocation: async (sourceId, input) => {
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: 'blocked' };
        const draft = prepared.drafts[0] as (typeof prepared.drafts)[number];
        const original = resolveOwnedRow(prepared.data, 'allocations', sourceId);
        if (!original) throw new Error('The allocation to duplicate no longer exists.');
        const receipt = await send(
          requireIntentRequest(
            buildAllocationDuplicate({
              ...prepared,
              original,
              args: { sourceId, id: draft.id, fields: draft.fields },
            }),
          ),
        );
        const [created] = requireCreatedRows(get, [draft.id]);
        if (!created) throw new Error('Allocation creation produced no row.');
        return { kind: 'created', value: created, ...readSaveAdvisory(receipt) };
      },
      updateAllocation: async (id, patch) => {
        const data = get().data;
        const existing = resolveOwnedRow(data, 'allocations', id);
        if (!existing || isBlockedByViewer()) return false;
        const effective = applyPatch(existing, patch);
        assertSuppliedHours(effective.hoursPerDay);
        assertDateRange(effective.startDate, effective.endDate);
        const intentRequest = buildAllocationUpdate({
          data,
          companyId: existing.companyId,
          original: existing,
          args: { id, changes: patch },
        });
        if (!intentRequest) return false;
        return readSaveAdvisory(await send(intentRequest));
      },
      reassignAllocation: async (id, placement) => {
        const data = get().data;
        const existing = resolveOwnedRow(data, 'allocations', id);
        if (!existing || isBlockedByViewer()) return false;
        // The server decides the target's hours and refuses a placement the target cannot take.
        assertDateRange(placement.startDate, placement.endDate);
        return readSaveAdvisory(
          await send({ intent: { operation: 'allocation.reassign', id, ...placement } }),
        );
      },
      deleteAllocation: async (id) => {
        if (isBlockedByViewer() || !resolveOwnedRow(get().data, 'allocations', id)) return;
        await send({ intent: { operation: 'allocation.delete', id } });
      },
      deleteAllocationSeriesFrom: async (id) => {
        if (isBlockedByViewer()) return;
        const target = resolveOwnedRow(get().data, 'allocations', id);
        if (!target) return;
        if (!target.seriesId) throw new Error('This allocation is not part of a repeat series.');
        // The server resolves the tail from its own rows, so a stale cache cannot pick the set; one
        // typed write deletes it, so a single Undo restores it.
        await send({ intent: { operation: 'allocation.delete', id, scope: 'future' } });
      },
    };
  };
}
