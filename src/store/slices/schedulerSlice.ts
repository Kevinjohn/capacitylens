import type { StateCreator } from 'zustand'
import { addDaysISO, startOfWeekISO, todayISO } from '@capacitylens/shared/lib/dateMath'
import {
  DEFAULT_RANGE_DAYS,
  DEFAULT_ZOOM,
  PAST_BUFFER_DAYS,
} from '../../lib/schedulerConfig'
import type { Filters, SchedulerUI, StoreState } from '../useStore'

type SchedulerSliceKeys =
  | 'ui'
  | 'setZoom'
  | 'setOriginDate'
  | 'panDays'
  | 'goToToday'
  | 'goToDate'
  | 'setDrawMode'
  | 'selectAllocation'
  | 'setFilters'
  | 'clearFilters'
  | 'toggleGroup'
  | 'jumpToResource'

export type SchedulerSlice = Pick<StoreState, SchedulerSliceKeys>

export function defaultSchedulerUI(emptyFilters: () => Filters): SchedulerUI {
  const weekStart = startOfWeekISO(todayISO())
  return {
    zoom: DEFAULT_ZOOM,
    originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
    rangeDays: PAST_BUFFER_DAYS + DEFAULT_RANGE_DAYS,
    focusDate: weekStart,
    drawMode: 'work',
    selectedAllocationId: null,
    filters: emptyFilters(),
    collapsedGroups: [],
    recenterToken: 0,
    scrollToResource: null,
  }
}

/** Scheduler navigation and filter state, isolated from domain persistence mutations. */
export function createSchedulerSlice(
  emptyFilters: () => Filters,
): StateCreator<StoreState, [], [], SchedulerSlice> {
  return (set) => ({
    ui: defaultSchedulerUI(emptyFilters),
    setZoom: (zoom) => set((state) => ({ ui: { ...state.ui, zoom } })),
    setOriginDate: (date) => set((state) => ({ ui: { ...state.ui, originDate: date } })),
    panDays: (delta) =>
      set((state) => ({
        ui: { ...state.ui, originDate: addDaysISO(state.ui.originDate, delta) },
      })),
    goToToday: () =>
      set((state) => {
        const account = state.activeAccountId
          ? state.data.accounts.find((candidate) => candidate.id === state.activeAccountId)
          : null
        const weekStart = startOfWeekISO(
          todayISO(account?.timezone ?? 'Etc/GMT'),
          account?.weekStartsOn ?? 1,
        )
        return {
          ui: {
            ...state.ui,
            originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
            focusDate: weekStart,
            recenterToken: state.ui.recenterToken + 1,
          },
        }
      }),
    goToDate: (date) =>
      set((state) => {
        const account = state.activeAccountId
          ? state.data.accounts.find((candidate) => candidate.id === state.activeAccountId)
          : null
        const weekStart = startOfWeekISO(date, account?.weekStartsOn ?? 1)
        return {
          ui: {
            ...state.ui,
            originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
            focusDate: weekStart,
            recenterToken: state.ui.recenterToken + 1,
          },
        }
      }),
    setDrawMode: (drawMode) => set((state) => ({ ui: { ...state.ui, drawMode } })),
    selectAllocation: (selectedAllocationId) =>
      set((state) => ({ ui: { ...state.ui, selectedAllocationId } })),
    setFilters: (patch) =>
      set((state) => {
        const filters: Filters = { ...state.ui.filters, ...patch }
        if (patch.activityId || patch.activityKind) {
          filters.clientId = null
          filters.projectId = null
        }
        if (patch.clientId || patch.projectId) {
          filters.activityId = null
          filters.activityKind = null
        }
        return { ui: { ...state.ui, filters } }
      }),
    clearFilters: () =>
      set((state) => ({ ui: { ...state.ui, filters: emptyFilters() } })),
    toggleGroup: (key) =>
      set((state) => ({
        ui: {
          ...state.ui,
          collapsedGroups: state.ui.collapsedGroups.includes(key)
            ? state.ui.collapsedGroups.filter((candidate) => candidate !== key)
            : [...state.ui.collapsedGroups, key],
        },
      })),
    jumpToResource: (id) =>
      set((state) => ({
        ui: {
          ...state.ui,
          filters: emptyFilters(),
          scrollToResource: {
            id,
            token: (state.ui.scrollToResource?.token ?? 0) + 1,
          },
        },
      })),
  })
}
