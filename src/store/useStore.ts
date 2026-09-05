import { create } from "zustand";
import { createAccountSlice } from "./slices/accountSlice";
import { createAllocationSlice } from "./slices/allocationSlice";
import { createCatalogSlice } from "./slices/catalogSlice";
import { createHistorySlice } from "./slices/historySlice";
import { createLifecycleSlice } from "./slices/lifecycleSlice";
import { createResourceSlice } from "./slices/resourceSlice";
import { createRuntimeSlice } from "./slices/runtimeSlice";
import { createSchedulerSlice } from "./slices/schedulerSlice";
import { createStoreInternals } from "./storeInternal";
import { emptyFilters, type StoreState } from "./types";

export type {
  AccountSummary,
  Draft,
  DrawMode,
  Filters,
  ImportSummary,
  LifecycleEntity,
  MasqueradeRuntimeState,
  Notice,
  Patch,
  SchedulerUI,
  StoreState,
  WeeksZoom,
} from "./types";
export { clearEntityLenses, emptyFilters, hasActiveFilters, hasLensFilter, hasProjectClientLens } from "./types";

export const useStore = create<StoreState>()((set, get, store) => {
  const internals = createStoreInternals(set, get);
  return {
    ...createAccountSlice(internals)(set, get, store),
    ...createHistorySlice(internals)(set, get, store),
    ...createRuntimeSlice(set, get, store),
    ...createSchedulerSlice(emptyFilters)(set, get, store),
    ...createCatalogSlice(internals)(set, get, store),
    ...createResourceSlice(internals)(set, get, store),
    ...createAllocationSlice({
      guarded: internals.guarded,
      addAllocationsImpl: internals.addAllocationsImpl,
      updateOwned: internals.updateOwned,
      assertAllocation: internals.assertAllocation,
      findOwned: internals.findOwned,
      mutate: internals.mutate,
    })(set, get, store),
    ...createLifecycleSlice(internals)(set, get, store),
  };
});
