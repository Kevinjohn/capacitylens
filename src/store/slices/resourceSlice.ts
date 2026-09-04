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
      guarded,
      guardedAdd,
      requireAccount,
      assertWorkingDays,
      assertHalfDays,
      withSnappedColor,
      mutate,
      updateOwned,
      findOwned,
    } = internals;
    return {
      addResource: guardedAdd(
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
        (e, input) => {
          assertScopedRefs(get().data, e.accountId, "resources", input);
          assertWorkingDays(e.workingDays);
          assertHalfDays(e.halfDays, e.workingDays);
          // Colour snap runs LAST, right before persisting — never before the asserts above, so a
          // rejected (throwing) add never substitutes a colour onto an entity that was never saved.
          const safe = withSnappedColor(e, e.kind === "external");
          mutate((d) => ({ ...d, resources: [...d.resources, safe] }));
          return safe;
        },
      ),
      updateResource: guarded((id: ID, patch: Patch<Resource>) => {
        updateOwned("resources", id, patch, (merged, existing) => {
          patch = isPlaceholderResource(merged) ? { ...patch, ...placeholderCapacityDefaults() } : patch;
          merged = { ...existing, ...patch };
          // `existing` enables the unchanged-parent relaxation (see assertScopedRefs): an unchanged
          // placeholder projectId whose project is ARCHIVED (absent from the server-mode active-only
          // slice) must not block an unrelated edit; a CHANGED projectId is still validated strictly.
          assertScopedRefs(get().data, existing.accountId, "resources", patch, existing);
          // Flipping a resource to external while it still owns loaded work / time-off would orphan
          // those dependents (the scheduler hides external capacity + time-off). A no-op when the
          // resource isn't becoming external. Mirrors the server's validateWrite resources branch.
          assertResourceProjectAllowsDependents(get().data, existing.accountId, id, merged, existing);
          assertResourceKindAllowsDependents(get().data, existing.accountId, id, merged.kind);
          if (patch.workingDays !== undefined) assertWorkingDays(patch.workingDays);
          if (patch.workingDays !== undefined || patch.halfDays !== undefined) {
            assertHalfDays(merged.halfDays, merged.workingDays);
          }
          const engagementPatch = merged.kind !== "person" ? { ...patch, engagement: "studio" as const } : patch;
          const colorPatch = withSnappedColor(engagementPatch, merged.kind === "external");
          return patch.workingHoursPerDay !== undefined
            ? { ...colorPatch, workingHoursPerDay: clampWorkingHoursPerDay(patch.workingHoursPerDay) }
            : colorPatch;
        });
      }),

      addTimeOff: guardedAdd(
        (input: Draft<TimeOff>): TimeOff => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
        (e, input) => {
          assertResourceExists(get().data, e.accountId, input.resourceId);
          assertDateRange(input.startDate, input.endDate);
          mutate((d) => ({ ...d, timeOff: [...d.timeOff, e] }));
          return e;
        },
      ),
      updateTimeOff: guarded((id: ID, patch: Patch<TimeOff>) => {
        updateOwned("timeOff", id, patch, (merged, existing) => {
          // Same merged-row rule as updateAllocation: the server re-runs assertResourceExists on the
          // full merged row, so a type/date/note-only edit of time-off on a now-EXTERNAL resource
          // would 400 there while succeeding here. See updateOwned.
          assertResourceExists(get().data, existing.accountId, merged.resourceId, existing);
          assertDateRange(merged.startDate, merged.endDate);
          return patch;
        });
      }),
      deleteTimeOff: guarded((id: ID) => {
        if (!findOwned(get().data, "timeOff", id)) return;
        mutate((d) => ({ ...d, timeOff: d.timeOff.filter((t) => t.id !== id) }));
      }),

      addClosure: guardedAdd(
        (input: Draft<Closure>): Closure => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
        (closure) => {
          if (closure.name.trim().length === 0) domainError("closure_name_required", "Closure name is required.");
          assertDateRange(closure.startDate, closure.endDate);
          mutate((data) => ({ ...data, closures: [...data.closures, closure] }));
          return closure;
        },
      ),
      updateClosure: guarded((id: ID, patch: Patch<Closure>) => {
        updateOwned("closures", id, patch, (merged) => {
          if (merged.name.trim().length === 0) domainError("closure_name_required", "Closure name is required.");
          assertDateRange(merged.startDate, merged.endDate);
          return patch;
        });
      }),
      deleteClosure: guarded((id: ID) => {
        if (!findOwned(get().data, "closures", id)) return;
        mutate((data) => ({ ...data, closures: data.closures.filter((closure) => closure.id !== id) }));
      }),
    };
  };
}
