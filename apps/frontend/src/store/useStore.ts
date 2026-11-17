import { create } from 'zustand';
import { setActiveDateStyle } from '@/lib/dateDisplay';
import { resolveDateStyle } from './selectors';
import { createAccountSlice } from './slices/accountSlice';
import { createAllocationSlice } from './slices/allocationSlice';
import { createPlanningSessionSlice } from './slices/planningSessionSlice';
import { createRuntimeSlice } from './slices/runtimeSlice';
import { createSchedulerSlice } from './slices/schedulerSlice';
import { createStoreInternals } from './storeInternal';
import { createStorePlanningTransport } from '@/data/planning/storePlanningTransport';
import { createTypedPlanningActions } from './typedPlanningActions';
import { buildEmptyFilters } from './types';
import type { StoreState } from './types';

export type {
  AccountSummary,
  Draft,
  DrawMode,
  Filters,
  MasqueradeRuntimeState,
  Notice,
  Patch,
  SchedulerUI,
  StoreState,
  WeeksZoom,
} from './types';
export {
  clearEntityLenses,
  buildEmptyFilters,
  hasActiveFilters,
  hasLensFilter,
  hasProjectClientLens,
} from './types';

/**
 * The app store: one active company projection, UI state and server-backed planning history.
 * CRUD actions throw on a tenancy or integrity violation and silently ignore a stale id; ids are
 * assigned here, never by callers, and timestamps are assigned by the server.
 */
export const useStore = create<StoreState>()((set, get, store) => {
  const internals = createStoreInternals(get);
  return {
    ...createAccountSlice()(set, get, store),
    ...createRuntimeSlice(set, get, store),
    ...createSchedulerSlice(buildEmptyFilters)(set, get, store),
    ...createPlanningSessionSlice(internals.blockedByViewer, createStorePlanningTransport())(
      set,
      get,
      store,
    ),
    ...createAllocationSlice(internals)(set, get, store),
    ...createTypedPlanningActions(get, internals),
  };
});

// Mirror company date style synchronously before React is notified so rendering and
// imperative notices read the same convention. Seed the mirror for the initial paint.
setActiveDateStyle(resolveDateStyle(useStore.getState().data, useStore.getState().activeAccountId));
useStore.subscribe((state) => {
  setActiveDateStyle(resolveDateStyle(state.data, state.activeAccountId));
});

// Entering a company opens its planning context and loads its canonical planning snapshot. Moving
// the grid's window reads the capacity figures for the new window, quietly so writes stay allowed
// meanwhile; the first read's own anchoring needs no second read, because that read already
// covered the anchored window.
useStore.subscribe((state, previous) => {
  if (state.activeAccountId !== previous.activeAccountId) void state.refreshPlanning();
  else if (state.ui.originDate !== previous.ui.originDate && previous.planning.today !== null) {
    void state.refreshPlanning({ fresh: true, quiet: true });
  }
});
