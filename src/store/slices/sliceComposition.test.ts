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
import { emptyFilters, useStore } from "../useStore";

describe("store slice composition", () => {
  it("owns every store key exactly once", () => {
    const set = useStore.setState;
    const get = useStore.getState;
    const internals = createStoreInternals(set, get);
    const slices = [
      createAccountSlice(internals)(set, get, useStore),
      createHistorySlice(internals)(set, get, useStore),
      createRuntimeSlice(set, get, useStore),
      createSchedulerSlice(emptyFilters)(set, get, useStore),
      createCatalogSlice(internals)(set, get, useStore),
      createResourceSlice(internals)(set, get, useStore),
      createAllocationSlice({
        guarded: internals.guarded,
        addAllocationsImpl: internals.addAllocationsImpl,
        updateOwned: internals.updateOwned,
        assertAllocation: internals.assertAllocation,
        findOwned: internals.findOwned,
        mutate: internals.mutate,
      })(set, get, useStore),
      createLifecycleSlice(internals)(set, get, useStore),
    ];

    const keySets = slices.map((slice) => new Set(Object.keys(slice)));
    for (let left = 0; left < keySets.length; left += 1) {
      for (let right = left + 1; right < keySets.length; right += 1) {
        expect([...keySets[left]].filter((key) => keySets[right].has(key))).toEqual([]);
      }
    }

    const composedKeys = [...new Set(slices.flatMap((slice) => Object.keys(slice)))].sort();
    expect(composedKeys).toEqual(Object.keys(useStore.getState()).sort());
  });

  it("keeps every StoreState action in the composed store", () => {
    const functionKeys = Object.values(useStore.getState()).filter((value) => typeof value === "function");

    expect(functionKeys).toHaveLength(76);
  });
});
