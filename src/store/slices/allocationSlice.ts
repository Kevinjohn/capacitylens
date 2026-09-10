import type { StateCreator, StoreApi } from "zustand";
import { assertAllocationWithinResourceAvailability, assertDateRange } from "@capacitylens/shared/domain/mutations";
import { clampHoursPerDay } from "@capacitylens/shared/types/entities";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import type { Allocation, AppData, ID } from "@capacitylens/shared/types/entities";
import type { StoreInternals } from "../storeInternal";
import type { Patch, StoreState } from "../types";

type AllocationSlice = Pick<
  StoreState,
  "addAllocation" | "addAllocations" | "updateAllocation" | "deleteAllocation" | "deleteAllocationSeriesFrom"
>;

export type AllocationSliceInternals = Pick<
  StoreInternals,
  "createGuardedAction" | "createAllocations" | "updateOwned" | "assertAllocation" | "resolveOwnedRow" | "mutate"
>;

function assertAvailabilityAfterPlacementChange(data: AppData, effective: Allocation, existing: Allocation): void {
  const placementChanged =
    effective.resourceId !== existing.resourceId ||
    effective.startDate !== existing.startDate ||
    effective.endDate !== existing.endDate ||
    (effective.ignoreWeekends === true) !== (existing.ignoreWeekends === true);
  if (!placementChanged) return;
  const resource = data.resources.find(
    (candidate) => candidate.accountId === existing.accountId && candidate.id === effective.resourceId,
  );
  const account = data.accounts.find((candidate) => candidate.id === existing.accountId);
  const accountWorkingDays = normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn ?? 1);
  if (resource) assertAllocationWithinResourceAvailability({ allocation: effective, resource, accountWorkingDays });
}

export function createAllocationSlice(
  internals: AllocationSliceInternals,
): StateCreator<StoreState, [], [], AllocationSlice> {
  return (_set, get) => {
    const { createGuardedAction, createAllocations, updateOwned, assertAllocation } = internals;
    return {
      addAllocation: (input) => {
        const allocation = createAllocations([input])[0];
        if (!allocation) throw new Error("Allocation creation produced no row.");
        return allocation;
      },
      addAllocations: createAllocations,
      updateAllocation: createGuardedAction(
        (id: ID, patch: Patch<Allocation>) =>
          updateOwned({
            key: "allocations",
            id: id,
            patch: patch,
            prepare: (merged, existing) => {
              // Clamp FIRST (same shared clamp as creation and import) so validation sees the value
              // that would actually be stored — a drag-resize rescale past 24h must land on 24 like
              // every other write boundary, not reject after the fact.
              const clampedPatch: Patch<Allocation> =
                patch.hoursPerDay !== undefined
                  ? { ...patch, hoursPerDay: clampHoursPerDay(patch.hoursPerDay) }
                  : patch;
              const effective = { ...merged, ...clampedPatch };
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
              assertAvailabilityAfterPlacementChange(get().data, effective, existing);
              // Repeat-series membership is system-owned at creation. An ordinary edit may change every
              // visible allocation field but cannot link, unlink or move the row between series.
              const safePatch = { ...clampedPatch };
              if (existing.seriesId === undefined) delete safePatch.seriesId;
              else safePatch.seriesId = existing.seriesId;
              return safePatch;
            },
          }),
        false,
      ),
      ...createAllocationDeletionActions(internals, get),
    };
  };
}

function createAllocationDeletionActions(
  internals: AllocationSliceInternals,
  get: StoreApi<StoreState>["getState"],
): Pick<AllocationSlice, "deleteAllocation" | "deleteAllocationSeriesFrom"> {
  const { createGuardedAction, resolveOwnedRow, mutate } = internals;
  return {
    deleteAllocation: createGuardedAction((id: ID) => {
      if (!resolveOwnedRow(get().data, "allocations", id)) return;
      mutate((data) => ({
        ...data,
        allocations: data.allocations.filter((allocation) => allocation.id !== id),
      }));
    }),
    deleteAllocationSeriesFrom: createGuardedAction((id: ID) => {
      const target = resolveOwnedRow(get().data, "allocations", id);
      if (!target) return;
      if (!target.seriesId) throw new Error("This allocation is not part of a repeat series.");
      const { accountId, seriesId, startDate } = target;
      // One mutation produces one history snapshot and one persistence diff/batch: a single Undo
      // restores the whole tail, and server mode commits all DELETE operations transactionally.
      mutate((data) => ({
        ...data,
        allocations: data.allocations.filter(
          (allocation) =>
            allocation.accountId !== accountId || allocation.seriesId !== seriesId || allocation.startDate < startDate,
        ),
      }));
    }),
  };
}
