import { create } from "zustand";
import { setActiveDateStyle } from "@/lib/dateDisplay";
import { resolveDateStyle } from "./selectors";
import { createAccountSlice } from "./slices/accountSlice";
import { createAllocationSlice } from "./slices/allocationSlice";
import { createHistorySlice } from "./slices/historySlice";
import { createLifecycleSlice } from "./slices/lifecycleSlice";
import { createRuntimeSlice } from "./slices/runtimeSlice";
import { createSchedulerSlice } from "./slices/schedulerSlice";
import { createStoreInternals } from "./storeInternal";
import { createStorePlanningTransport } from "@/data/planning/volatilePlanningTransport";
import { createTypedPlanningActions } from "./typedPlanningActions";
import { buildEmptyFilters } from "./types";
import type { StoreState } from "./types";

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
export { clearEntityLenses, buildEmptyFilters, hasActiveFilters, hasLensFilter, hasProjectClientLens } from "./types";

/**
 * The app store: scoped entity data, UI state and undo/redo history, composed from the slices.
 * CRUD actions throw on a tenancy or integrity violation and silently ignore a stale id; ids and
 * timestamps are assigned here, never by callers.
 */
export const useStore = create<StoreState>()((set, get, store) => {
  const internals = createStoreInternals(set, get);
  return {
    ...createAccountSlice(internals)(set, get, store),
    ...createHistorySlice(internals)(set, get, store),
    ...createRuntimeSlice(set, get, store),
    ...createSchedulerSlice(buildEmptyFilters)(set, get, store),
    ...createAllocationSlice(
      internals,
      createStorePlanningTransport(() => get().data),
    )(set, get, store),
    ...createLifecycleSlice(internals)(set, get, store),
    ...createTypedPlanningActions(get, internals.blockedByViewer),
  };
});

// Mirror company date style synchronously before React is notified so rendering and
// imperative notices read the same convention. Seed the mirror for the initial paint.
setActiveDateStyle(resolveDateStyle(useStore.getState().data, useStore.getState().activeAccountId));
useStore.subscribe((state) => {
  setActiveDateStyle(resolveDateStyle(state.data, state.activeAccountId));
});

// Entering a company opens its planning context and loads its canonical planning snapshot.
useStore.subscribe((state, previous) => {
  if (state.activeAccountId !== null && state.activeAccountId !== previous.activeAccountId) {
    void state.refreshPlanning();
  }
});
