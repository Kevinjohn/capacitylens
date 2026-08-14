import type { StateCreator } from "zustand";
import { addDaysISO, startOfWeekISO, todayISO } from "@capacitylens/shared/lib/dateMath";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import { DEFAULT_RANGE_DAYS, DEFAULT_ZOOM, PAST_BUFFER_DAYS } from "../../lib/schedulerConfig";
import type { AppData, ID, ISODate } from "@capacitylens/shared/types/entities";
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

type SchedulerSlice = Pick<StoreState, SchedulerSliceKeys>;

/** The grid's origin/focus pair for a week: the buffered left edge plus the week itself. */
export function weekAnchorOn(weekStart: ISODate): { originDate: ISODate; focusDate: ISODate } {
  return { originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS), focusDate: weekStart };
}

/** The same pair for an account's CURRENT week, read through its own calendar settings. Used both
 *  by "go to today" and by the tenant-boundary resets in useStore, so a company always opens on the
 *  week its own time zone / week start says it is. */
export function weekAnchor(data: AppData, accountId: ID | null): { originDate: ISODate; focusDate: ISODate } {
  return weekAnchorOn(startOfWeekISO(todayISO(timeZoneFor(data, accountId)), weekStartsOnFor(data, accountId)));
}

function defaultSchedulerUI(emptyFilters: () => Filters): SchedulerUI {
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

/** Open the grid on `weekStart` and ask it to scroll there — the shared body of the two
 *  "navigate to a week" actions. */
function recenterOn(state: StoreState, weekStart: ISODate): { ui: SchedulerUI } {
  return {
    ui: {
      ...state.ui,
      ...weekAnchorOn(weekStart),
      recenterToken: state.ui.recenterToken + 1,
    },
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
      set((state) =>
        recenterOn(
          state,
          startOfWeekISO(
            todayISO(timeZoneFor(state.data, state.activeAccountId)),
            weekStartsOnFor(state.data, state.activeAccountId),
          ),
        ),
      ),
    goToDate: (date) =>
      set((state) => recenterOn(state, startOfWeekISO(date, weekStartsOnFor(state.data, state.activeAccountId)))),
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
