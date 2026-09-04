import type { StateCreator } from "zustand";
import { assertDateRange } from "@capacitylens/shared/domain/mutations";
import { clampHoursPerDay } from "@capacitylens/shared/types/entities";
import type { Allocation, ID } from "@capacitylens/shared/types/entities";
import type { StoreInternals } from "../storeInternal";
import type { Patch, StoreState } from "../types";

type AllocationSlice = Pick<
  StoreState,
  "addAllocation" | "addAllocations" | "updateAllocation" | "deleteAllocation" | "deleteAllocationSeriesFrom"
>;

export function createAllocationSlice(internals: StoreInternals): StateCreator<StoreState, [], [], AllocationSlice> {
  return (_set, get) => {
    const { guarded, addAllocationsImpl, updateOwned, assertAllocation, findOwned, mutate } = internals;
    return {
      addAllocation: (input) => addAllocationsImpl([input])[0],
      addAllocations: addAllocationsImpl,
      updateAllocation: guarded(
        (id: ID, patch: Patch<Allocation>) =>
          updateOwned("allocations", id, patch, (merged, existing) => {
            // Clamp FIRST (same shared clamp as creation and import) so validation sees the value
            // that would actually be stored — a drag-resize rescale past 24h must land on 24 like
            // every other write boundary, not reject after the fact.
            const clampedPatch: Patch<Allocation> =
              patch.hoursPerDay !== undefined ? { ...patch, hoursPerDay: clampHoursPerDay(patch.hoursPerDay) } : patch;
            const effective = { ...merged, ...clampedPatch } as Allocation;
            // The server re-runs assertAllocationRefs on the full merged row on EVERY write, so a
            // note/status/date-only edit of an allocation whose resource is now EXTERNAL with a
            // non-zero load (legacy pre-v0.8.1 data, or after a resource kind-flip) would 400 there
            // while succeeding here. Validating `effective` rejects exactly what the server rejects;
            // a note-only patch on a valid (non-external) row still passes.
            assertAllocation(
              get().data,
              existing.accountId,
              effective.resourceId,
              effective.activityId,
              effective.hoursPerDay,
              effective.projectId,
              existing,
            );
            assertDateRange(effective.startDate, effective.endDate);
            // Repeat-series membership is system-owned at creation. An ordinary edit may change every
            // visible allocation field but cannot link, unlink or move the row between series.
            const safePatch = { ...clampedPatch };
            if (existing.seriesId === undefined) delete safePatch.seriesId;
            else safePatch.seriesId = existing.seriesId;
            return safePatch;
          }),
        false,
      ),
      deleteAllocation: guarded((id: ID) => {
        if (!findOwned(get().data, "allocations", id)) return;
        mutate((d) => ({
          ...d,
          allocations: d.allocations.filter((a) => a.id !== id),
        }));
      }),
      deleteAllocationSeriesFrom: guarded((id: ID) => {
        const target = findOwned(get().data, "allocations", id);
        if (!target) return;
        if (!target.seriesId) throw new Error("This allocation is not part of a repeat series.");
        const { accountId, seriesId, startDate } = target;
        // One mutation produces one history snapshot and one persistence diff/batch: a single Undo
        // restores the whole tail, and server mode commits all DELETE operations transactionally.
        mutate((d) => ({
          ...d,
          allocations: d.allocations.filter(
            (allocation) =>
              allocation.accountId !== accountId ||
              allocation.seriesId !== seriesId ||
              allocation.startDate < startDate,
          ),
        }));
      }),
    };
  };
}
