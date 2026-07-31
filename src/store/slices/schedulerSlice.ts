import type { StateCreator } from "zustand";
import { addDaysISO, startOfWeekISO, todayISO } from "@capacitylens/shared/lib/dateMath";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import { DEFAULT_RANGE_DAYS, DEFAULT_ZOOM, PAST_BUFFER_DAYS } from "../../lib/schedulerConfig";
import type { Filters, SchedulerUI, StoreState } from "../useStore";
import { timeZoneFor, weekStartsOnFor } from "../selectors";

type SchedulerSliceKeys =
  | "ui"
  | "setZoom"
  | "setOriginDate"
  | "panDays"
  | "goToToday"
  | "goToDate"
  | "setDrawMode"
  | "selectAllocation"
  | "setFilters"
  | "clearFilters"
  | "toggleGroup"
  | "jumpToResource"
  | "consumeResourceJump";

export type SchedulerSlice = Pick<StoreState, SchedulerSliceKeys>;

export function defaultSchedulerUI(emptyFilters: () => Filters): SchedulerUI {
  const weekStart = startOfWeekISO(todayISO());
  return {
    zoom: DEFAULT_ZOOM,
    originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
    rangeDays: PAST_BUFFER_DAYS + DEFAULT_RANGE_DAYS,
    focusDate: weekStart,
    drawMode: "work",
    selectedAllocationId: null,
    filters: emptyFilters(),
    collapsedGroups: [],
    recenterToken: 0,
    scrollToResource: null,
  };
}

/** Scheduler navigation and filter state, isolated from domain persistence mutations. */
export function createSchedulerSlice(emptyFilters: () => Filters): StateCreator<StoreState, [], [], SchedulerSlice> {
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
        const weekStart = startOfWeekISO(
          todayISO(timeZoneFor(state.data, state.activeAccountId)),
          weekStartsOnFor(state.data, state.activeAccountId),
        );
        return {
          ui: {
            ...state.ui,
            originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
            focusDate: weekStart,
            recenterToken: state.ui.recenterToken + 1,
          },
        };
      }),
    goToDate: (date) =>
      set((state) => {
        const weekStart = startOfWeekISO(date, weekStartsOnFor(state.data, state.activeAccountId));
        return {
          ui: {
            ...state.ui,
            originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
            focusDate: weekStart,
            recenterToken: state.ui.recenterToken + 1,
          },
        };
      }),
    setDrawMode: (drawMode) => set((state) => ({ ui: { ...state.ui, drawMode } })),
    selectAllocation: (selectedAllocationId) => set((state) => ({ ui: { ...state.ui, selectedAllocationId } })),
    setFilters: (patch) =>
      set((state) => {
        const normalizedPatch = { ...patch };
        // If an invalid patch supplies both lenses, the kind wins consistently with the toolbar.
        // Normalize before merging so the two branches cannot clear both requested values.
        if (patch.activityKind) normalizedPatch.activityId = null;
        else if (patch.activityId) normalizedPatch.activityKind = null;
        const filters: Filters = { ...state.ui.filters, ...normalizedPatch };
        // A project is always subordinate to its selected client. Property presence matters here:
        // explicitly clearing the client must clear its stale project even though null is falsy.
        if (patch.clientId !== undefined && patch.projectId === undefined) filters.projectId = null;
        const patchesActivityLens = !!(patch.activityId || patch.activityKind);
        const patchesProjectLens = !!(patch.clientId || patch.projectId);
        // A malformed bulk patch spanning both lens families resolves to the activity family. Use
        // one branch so the two requests cannot clear each other and silently produce no lens.
        if (patchesActivityLens) {
          filters.clientId = null;
          filters.projectId = null;
        } else if (patchesProjectLens) {
          filters.activityId = null;
          filters.activityKind = null;
        }
        return { ui: { ...state.ui, filters } };
      }),
    clearFilters: () => set((state) => ({ ui: { ...state.ui, filters: emptyFilters() } })),
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
      set((state) => {
        const resource = state.data.resources.find((candidate) => candidate.id === id);
        const knownDiscipline =
          resource?.disciplineId &&
          state.data.disciplines.some((discipline) => discipline.id === resource.disciplineId);
        const groupKey = !resource
          ? null
          : isExternalResource(resource)
            ? "external"
            : knownDiscipline
              ? resource.disciplineId
              : "none";
        return {
          ui: {
            ...state.ui,
            filters: emptyFilters(),
            collapsedGroups: groupKey
              ? state.ui.collapsedGroups.filter((candidate) => candidate !== groupKey)
              : state.ui.collapsedGroups,
            scrollToResource: {
              id,
              token: (state.ui.scrollToResource?.token ?? 0) + 1,
              consumed: false,
            },
          },
        };
      }),
    consumeResourceJump: (token) =>
      set((state) => {
        const request = state.ui.scrollToResource;
        if (!request || request.token !== token || request.consumed) return state;
        return {
          ui: {
            ...state.ui,
            scrollToResource: { ...request, consumed: true },
          },
        };
      }),
  });
}
