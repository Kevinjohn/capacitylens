import { create } from 'zustand'
import { setActiveDateStyle } from '@/lib/dateDisplay'
import { resolveDateStyle } from './selectors'
import { createCompanySlice } from './slices/companySlice'
import { createAllocationSlice } from './slices/allocationSlice'
import { createPlanningSessionSlice } from './slices/planningSessionSlice'
import { createRuntimeSlice } from './slices/runtimeSlice'
import { createSchedulerSlice } from './slices/schedulerSlice'
import { createStoreInternals } from './storeInternal'
import { createStorePlanningTransport } from '@/data/planning/storePlanningTransport'
import { createTypedPlanningActions } from './typedPlanningActions'
import { buildEmptyFilters } from './types'
import type { StoreState } from './types'

export type {
  CompanySummary,
  Draft,
  DrawMode,
  Filters,
  MasqueradeRuntimeState,
  Notice,
  Patch,
  SchedulerUI,
  StoreState,
  WeeksZoom,
} from './types'
export {
  clearEntityLenses,
  buildEmptyFilters,
  hasActiveFilters,
  hasLensFilter,
  hasProjectClientLens,
} from './types'

/**
 * The app store: one active company projection, UI state and server-backed planning history.
 * CRUD actions throw on a company scoping or integrity violation and silently ignore a stale id; ids are
 * assigned here, never by callers, and timestamps are assigned by the server.
 */
export const useStore = create<StoreState>()((set, get, store) => {
  const internals = createStoreInternals(get)
  return {
    ...createCompanySlice()(set, get, store),
    ...createRuntimeSlice(set, get, store),
    ...createSchedulerSlice(buildEmptyFilters)(set, get, store),
    ...createPlanningSessionSlice(internals.isBlockedByViewer, createStorePlanningTransport())(
      set,
      get,
      store
    ),
    ...createAllocationSlice(internals)(set, get, store),
    ...createTypedPlanningActions(get, internals),
  }
})

// Mirror company date style synchronously before React is notified so rendering and
// imperative notices read the same convention. Seed the mirror for the initial paint.
setActiveDateStyle(resolveDateStyle(useStore.getState().data, useStore.getState().activeCompanyId))
useStore.subscribe((state) => {
  setActiveDateStyle(resolveDateStyle(state.data, state.activeCompanyId))
})

// Entering a company opens its planning context and loads its canonical planning snapshot. Moving
// the grid's window reads nothing: its capacity figures are built from the rows already held.
useStore.subscribe((state, previous) => {
  if (state.activeCompanyId !== previous.activeCompanyId) {
    void state.refreshPlanning()
  }
})
