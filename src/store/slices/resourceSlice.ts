import type { StateCreator } from "zustand";
import { newId } from "@capacitylens/shared/lib/id";
import {
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertScopedRefs,
} from "@capacitylens/shared/domain/mutations";
import { domainError } from "@capacitylens/shared/domain/errors";
import {
  clampWorkingHoursPerDay,
  isPlaceholderResource,
  placeholderCapacityDefaults,
} from "@capacitylens/shared/types/entities";
import type { Closure, ID, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { stamp, type StoreInternals } from "../storeInternal";
import type { Draft, Patch, StoreState } from "../types";

type ResourceSlice = Pick<
  StoreState,
  | "addResource"
  | "updateResource"
  | "addTimeOff"
  | "updateTimeOff"
  | "deleteTimeOff"
  | "addClosure"
  | "updateClosure"
  | "deleteClosure"
>;

export function createResourceSlice(internals: StoreInternals): StateCreator<StoreState, [], [], ResourceSlice> {
  return (_set, get) => {
    const {
      createGuardedAction,
      createGuardedAddAction,
      requireAccount,
      assertWorkingDays,
      assertHalfDays,
      applySnappedColor,
      mutate,
      updateOwned,
      resolveOwnedRow,
    } = internals;
    return {
      addResource: createGuardedAddAction(
        (input: Draft<Resource>): Resource => {
          // Placeholder drafts carry inert defaults for a complete entity contract; normalise them
          // again here so the store remains the authoritative last line for persisted values.
          const workingPattern = isPlaceholderResource(input)
            ? placeholderCapacityDefaults()
            : { workingDays: input.workingDays, halfDays: input.halfDays };
          return {
            ...input,
            ...workingPattern,
            // Engagement did not exist in older programmatic callers. Default them to Studio, and
            // keep placeholders/external rows outside the people classification by forcing Studio.
            engagement: input.kind === "person" ? (input.engagement ?? "studio") : "studio",
            // Clamp working hours/day (the store is the last line; resource forms write the fixed 8h,
            // but imports and other programmatic callers must not persist NaN / 0 / >24h capacity).
            // 0 is rejected (a resource works a positive day) — distinct from an allocation, where 0 is legal.
            workingHoursPerDay: clampWorkingHoursPerDay(input.workingHoursPerDay),
            id: newId(),
            accountId: requireAccount(),
            ...stamp(),
          };
        },
        (entity, input) => {
          assertScopedRefs(get().data, entity.accountId, "resources", input);
          assertWorkingDays(entity.workingDays);
          assertHalfDays(entity.halfDays, entity.workingDays);
          // Colour snap runs LAST, right before persisting — never before the asserts above, so a
          // rejected (throwing) add never substitutes a colour onto an entity that was never saved.
          const safe = applySnappedColor({ patch: entity, allowNeutral: entity.kind === "external" });
          mutate((data) => ({ ...data, resources: [...data.resources, safe] }));
          return safe;
        },
      ),
      updateResource: createGuardedAction((id: ID, patch: Patch<Resource>) => {
        updateOwned({
          key: "resources",
          id: id,
          patch: patch,
          prepare: (merged, existing) => {
            const preparedPatch = isPlaceholderResource(merged)
              ? { ...patch, ...placeholderCapacityDefaults() }
              : patch;
            const preparedResource = { ...existing, ...preparedPatch };
            // `existing` enables the unchanged-parent relaxation (see assertScopedRefs): an unchanged
            // placeholder projectId whose project is ARCHIVED (absent from the server-mode active-only
            // slice) must not block an unrelated edit; a CHANGED projectId is still validated strictly.
            assertScopedRefs(get().data, existing.accountId, "resources", preparedPatch, existing);
            // Flipping a resource to external while it still owns loaded work / time-off would orphan
            // those dependents (the scheduler hides external capacity + time-off). A no-op when the
            // resource isn't becoming external. Mirrors the server's validateWrite resources branch.
            assertResourceProjectAllowsDependents(get().data, existing.accountId, id, preparedResource, existing);
            assertResourceKindAllowsDependents(get().data, existing.accountId, id, preparedResource.kind);
            if (preparedPatch.workingDays !== undefined) assertWorkingDays(preparedPatch.workingDays);
            if (preparedPatch.workingDays !== undefined || preparedPatch.halfDays !== undefined) {
              assertHalfDays(preparedResource.halfDays, preparedResource.workingDays);
            }
            const engagementPatch =
              preparedResource.kind !== "person" ? { ...preparedPatch, engagement: "studio" as const } : preparedPatch;
            const colorPatch = applySnappedColor({
              patch: engagementPatch,
              allowNeutral: preparedResource.kind === "external",
            });
            return preparedPatch.workingHoursPerDay !== undefined
              ? { ...colorPatch, workingHoursPerDay: clampWorkingHoursPerDay(preparedPatch.workingHoursPerDay) }
              : colorPatch;
          },
        });
      }),

      addTimeOff: createGuardedAddAction(
        (input: Draft<TimeOff>): TimeOff => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
        (entity, input) => {
          assertResourceExists(get().data, entity.accountId, input.resourceId);
          assertDateRange(input.startDate, input.endDate);
          mutate((data) => ({ ...data, timeOff: [...data.timeOff, entity] }));
          return entity;
        },
      ),
      updateTimeOff: createGuardedAction((id: ID, patch: Patch<TimeOff>) => {
        updateOwned({
          key: "timeOff",
          id: id,
          patch: patch,
          prepare: (merged, existing) => {
            // Same merged-row rule as updateAllocation: the server re-runs assertResourceExists on the
            // full merged row, so a type/date/note-only edit of time-off on a now-EXTERNAL resource
            // would 400 there while succeeding here. See updateOwned.
            assertResourceExists(get().data, existing.accountId, merged.resourceId, existing);
            assertDateRange(merged.startDate, merged.endDate);
            return patch;
          },
        });
      }),
      deleteTimeOff: createGuardedAction((id: ID) => {
        if (!resolveOwnedRow(get().data, "timeOff", id)) return;
        mutate((data) => ({ ...data, timeOff: data.timeOff.filter((activity) => activity.id !== id) }));
      }),

      addClosure: createGuardedAddAction(
        (input: Draft<Closure>): Closure => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
        (closure) => {
          if (closure.name.trim().length === 0) domainError("closure_name_required", "Closure name is required.");
          assertDateRange(closure.startDate, closure.endDate);
          mutate((data) => ({ ...data, closures: [...data.closures, closure] }));
          return closure;
        },
      ),
      updateClosure: createGuardedAction((id: ID, patch: Patch<Closure>) => {
        updateOwned({
          key: "closures",
          id: id,
          patch: patch,
          prepare: (merged) => {
            if (merged.name.trim().length === 0) domainError("closure_name_required", "Closure name is required.");
            assertDateRange(merged.startDate, merged.endDate);
            return patch;
          },
        });
      }),
      deleteClosure: createGuardedAction((id: ID) => {
        if (!resolveOwnedRow(get().data, "closures", id)) return;
        mutate((data) => ({ ...data, closures: data.closures.filter((closure) => closure.id !== id) }));
      }),
    };
  };
}
