import { describe, expect, it } from "vitest";
import { createAccountSlice } from "./accountSlice";
import { createAllocationSlice } from "./allocationSlice";
import { createCatalogSlice } from "./catalogSlice";
import { createHistorySlice } from "./historySlice";
import { createLifecycleSlice } from "./lifecycleSlice";
import { createResourceSlice } from "./resourceSlice";
import { createRuntimeSlice } from "./runtimeSlice";
import { createSchedulerSlice } from "./schedulerSlice";
import { createStoreInternals } from "../storeInternal";
import { buildEmptyFilters, useStore } from "../useStore";

describe("store slice composition", () => {
  it("owns every store key exactly once", () => {
    const set = useStore.setState;
    const get = useStore.getState;
    const internals = createStoreInternals(set, get);
    const slices = [
      createAccountSlice(internals)(set, get, useStore),
      createHistorySlice(internals)(set, get, useStore),
      createRuntimeSlice(set, get, useStore),
      createSchedulerSlice(buildEmptyFilters)(set, get, useStore),
      createCatalogSlice(internals)(set, get, useStore),
      createResourceSlice(internals)(set, get, useStore),
      createAllocationSlice({
        createGuardedAction: internals.createGuardedAction,
        createAllocations: internals.createAllocations,
        updateOwned: internals.updateOwned,
        assertAllocation: internals.assertAllocation,
        resolveOwnedRow: internals.resolveOwnedRow,
        mutate: internals.mutate,
      })(set, get, useStore),
      createLifecycleSlice(internals)(set, get, useStore),
    ];

    const keySets = slices.map((slice) => new Set(Object.keys(slice)));
    for (let left = 0; left < keySets.length; left += 1) {
      for (let right = left + 1; right < keySets.length; right += 1) {
        const leftKeys = keySets[left];
        const rightKeys = keySets[right];
        if (!leftKeys || !rightKeys) throw new Error("Expected slice key sets");
        expect([...leftKeys].filter((key) => rightKeys.has(key))).toEqual([]);
      }
    }

    const composedKeys = [...new Set(slices.flatMap((slice) => Object.keys(slice)))].sort();
    expect(composedKeys).toEqual(Object.keys(useStore.getState()).sort());
  });

  it("keeps every StoreState action in the composed store", () => {
    const actionNames = Object.entries(useStore.getState())
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);

    expect(actionNames).toEqual(
      expect.arrayContaining([
        "addAccount",
        "updateAccount",
        "deleteAccount",
        "setActiveAccount",
        "beginAccountSummariesRequest",
        "setAccountSummaries",
        "replaceAll",
        "importData",
        "setHydrated",
        "setPersistError",
        "setLoadError",
        "setConnectionError",
        "setNotice",
        "announceCapacity",
        "setDirtyForm",
        "setDirtyFormSource",
        "setDraggingAllocation",
        "setTheme",
        "setUtilizationPref",
        "setBarLabelPref",
        "setSidebarOpen",
        "setMinimiseWeekends",
        "setSnapToWeekStart",
        "setCompactView",
        "setFakeSignedIn",
        "setActiveRole",
        "invalidateMemberships",
        "setMasquerade",
        "clearUndoHistory",
        "signOutDemo",
        "undo",
        "redo",
        "addDiscipline",
        "updateDiscipline",
        "deleteDiscipline",
        "addResource",
        "updateResource",
        "addClient",
        "updateClient",
        "addProject",
        "updateProject",
        "addPhase",
        "updatePhase",
        "deletePhase",
        "addActivity",
        "updateActivity",
        "deleteActivity",
        "addAllocation",
        "addAllocations",
        "updateAllocation",
        "deleteAllocation",
        "deleteAllocationSeriesFrom",
        "addTimeOff",
        "addTimeOffs",
        "updateTimeOff",
        "deleteTimeOff",
        "addClosure",
        "updateClosure",
        "deleteClosure",
        "archiveEntity",
        "unarchiveEntity",
        "softDeleteEntity",
        "purgeEntity",
        "setZoom",
        "setOriginDate",
        "panDays",
        "goToToday",
        "goToDate",
        "setDrawMode",
        "selectAllocation",
        "setFilters",
        "clearFilters",
        "toggleGroup",
        "jumpToResource",
        "consumeResourceJump",
      ]),
    );
  });
});
