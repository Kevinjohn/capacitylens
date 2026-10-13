import type { StateCreator, StoreApi } from "zustand";
import { assertDateRange } from "@capacitylens/shared/domain/mutations";
import { assertAllocationPlacement } from "@capacitylens/shared/domain/placement";
import { clampHoursPerDay } from "@capacitylens/shared/types/entities";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import type { Allocation, AppData, ID } from "@capacitylens/shared/types/entities";
import type { StoreInternals } from "@/store/storeInternal";
import type { Patch, StoreState } from "@/store/types";

type AllocationSlice = Pick<
  StoreState,
  "addAllocation" | "addAllocations" | "updateAllocation" | "deleteAllocation" | "deleteAllocationSeriesFrom"
>;

/** Store capabilities used by allocation actions. */
export type AllocationSliceInternals = Pick<
  StoreInternals,
  | "createGuardedAction"
  | "createGuardedValueAction"
  | "createAllocations"
  | "updateOwned"
  | "assertAllocation"
  | "resolveOwnedRow"
  | "mutate"
>;

function assertAvailabilityAfterPlacementChange(data: AppData, effective: Allocation, existing: Allocation): void {
  const resource = data.resources.find(
    (candidate) => candidate.accountId === existing.accountId && candidate.id === effective.resourceId,
  );
  const account = data.accounts.find((candidate) => candidate.id === existing.accountId);
  const accountWorkingDays = normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn ?? 1);
  if (resource) assertAllocationPlacement({ allocation: effective, existing, resource, accountWorkingDays });
}

/** Create allocation actions for the store. */
export function createAllocationSlice(
  internals: AllocationSliceInternals,
): StateCreator<StoreState, [], [], AllocationSlice> {
  return (_set, get) => {
    const { createGuardedValueAction, createAllocations, updateOwned, assertAllocation } = internals;
    return {
      addAllocation: (input) => {
        const result = createAllocations([input]);
        if (result.kind === "blocked") return result;
        const allocation = result.value[0];
        if (!allocation) throw new Error("Allocation creation produced no row.");
        return { kind: "created", value: allocation };
      },
      addAllocations: createAllocations,
      updateAllocation: createGuardedValueAction(
        (id: ID, patch: Patch<Allocation>) =>
          updateOwned({
            key: "allocations",
            id: id,
            patch: patch,
            prepare: (merged, existing) => {
              // Clamp first (same shared clamp as creation and import) so validation sees the value
              // that would actually be stored. A drag-resize rescale past 24h must land on 24 like
              // every other write boundary, not reject after the fact.
              const clampedPatch: Patch<Allocation> =
                patch.hoursPerDay !== undefined
                  ? { ...patch, hoursPerDay: clampHoursPerDay(patch.hoursPerDay) }
                  : patch;
              const effective: Allocation = {
                ...merged,
                ...(clampedPatch.hoursPerDay === undefined ? {} : { hoursPerDay: clampedPatch.hoursPerDay }),
              };
              // Validate the merged row so unrelated edits cannot preserve invalid external-resource
              // load that the server would reject.
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
              if (existing.seriesId == null) delete safePatch.seriesId;
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
