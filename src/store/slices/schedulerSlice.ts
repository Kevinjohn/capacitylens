import type { StateCreator } from "zustand";
import { addDaysISO, startOfWeekISO, todayISO } from "@capacitylens/shared/lib/dateMath";
import { lifecycleStatus } from "@capacitylens/shared/domain/lifecycle";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import { DEFAULT_RANGE_DAYS, DEFAULT_ZOOM, PAST_BUFFER_DAYS } from "../../lib/schedulerConfig";
import type { AppData, ID, ISODate } from "@capacitylens/shared/types/entities";
import type { Filters, SchedulerUI, StoreState } from "../types";
import { resolveTimeZone, resolveWeekStart } from "../selectors";

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
type SchedulerSet = Parameters<StateCreator<StoreState, [], [], SchedulerSlice>>[0];

/** The grid's origin/focus pair for a week: the buffered left edge plus the week itself. */
export function buildWeekAnchor(weekStart: ISODate): { originDate: ISODate; focusDate: ISODate } {
  return { originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS), focusDate: weekStart };
}

/** The same pair for an account's CURRENT week, read through its own calendar settings. Used both
 *  by "go to today" and by the tenant-boundary resets in useStore, so a company always opens on the
 *  week its own time zone / week start says it is. */
export function readCurrentWeekAnchor(
  data: AppData,
  accountId: ID | null,
): { originDate: ISODate; focusDate: ISODate } {
  return buildWeekAnchor(startOfWeekISO(todayISO(resolveTimeZone(data, accountId)), resolveWeekStart(data, accountId)));
}

function createDefaultSchedulerUi(emptyFilters: () => Filters): SchedulerUI {
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
      ...buildWeekAnchor(weekStart),
      recenterToken: state.ui.recenterToken + 1,
    },
  };
}

function hasSuppliedValue(value: ID | Filters["activityKind"] | undefined): boolean {
  return value !== null && value !== undefined;
}

function applyFilterPatch(filters: Filters, patch: Partial<Filters>, projects: AppData["projects"]): Filters {
  const normalizedPatch = { ...patch };
  // If an invalid patch supplies both lenses, the kind wins consistently with the toolbar.
  // Normalize before merging so the two branches cannot clear both requested values.
  if (hasSuppliedValue(patch.activityKind)) normalizedPatch.activityId = null;
  else if (hasSuppliedValue(patch.activityId)) normalizedPatch.activityKind = null;

  const nextFilters: Filters = { ...filters, ...normalizedPatch };
  // A project is always subordinate to its selected client. Property presence matters here:
  // explicitly clearing the client must clear its stale project even though null is falsy. When
  // selecting a client, retain an existing project only when it belongs to that client.
  if (patch.clientId !== undefined && patch.projectId === undefined) {
    if (patch.clientId === null) {
      nextFilters.projectId = null;
    } else if (
      nextFilters.projectId !== null &&
      !projects.some(
        (project) =>
          project.id === nextFilters.projectId &&
          project.clientId === patch.clientId &&
          lifecycleStatus(project) === "active",
      )
    ) {
      nextFilters.projectId = null;
    }
  }

  const patchesActivityLens = hasSuppliedValue(patch.activityId) || hasSuppliedValue(patch.activityKind);
  const patchesProjectLens = hasSuppliedValue(patch.clientId) || hasSuppliedValue(patch.projectId);
  // A malformed bulk patch spanning both lens families resolves to the activity family.
  if (patchesActivityLens) {
    nextFilters.clientId = null;
    nextFilters.projectId = null;
  } else if (patchesProjectLens) {
    nextFilters.activityId = null;
    nextFilters.activityKind = null;
  }
  return nextFilters;
}

function resolveResourceGroupKey(state: StoreState, id: ID): string | null {
  const resource = state.data.resources.find((candidate) => candidate.id === id);
  if (!resource) return null;
  if (isExternalResource(resource)) return "external";
  if (
    resource.disciplineId !== undefined &&
    state.data.disciplines.some((discipline) => discipline.id === resource.disciplineId)
  ) {
    return resource.disciplineId;
  }
  return "none";
}

function createFilterActions(
  set: SchedulerSet,
  emptyFilters: () => Filters,
): Pick<SchedulerSlice, "setFilters" | "clearFilters"> {
  return {
    setFilters: (patch) =>
      set((state) => ({
        ui: { ...state.ui, filters: applyFilterPatch(state.ui.filters, patch, state.data.projects) },
      })),
    clearFilters: () => set((state) => ({ ui: { ...state.ui, filters: emptyFilters() } })),
  };
}

function createResourceJumpActions(
  set: SchedulerSet,
  emptyFilters: () => Filters,
): Pick<SchedulerSlice, "jumpToResource" | "consumeResourceJump"> {
  return {
    jumpToResource: (id) =>
      set((state) => {
        const groupKey = resolveResourceGroupKey(state, id);
        return {
          ui: {
            ...state.ui,
            filters: emptyFilters(),
            collapsedGroups:
              groupKey === null
                ? state.ui.collapsedGroups
                : state.ui.collapsedGroups.filter((candidate) => candidate !== groupKey),
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
        return { ui: { ...state.ui, scrollToResource: { ...request, consumed: true } } };
      }),
  };
}

/** Scheduler navigation and filter state, isolated from domain persistence mutations. */
export function createSchedulerSlice(emptyFilters: () => Filters): StateCreator<StoreState, [], [], SchedulerSlice> {
  return (set) => ({
    ui: createDefaultSchedulerUi(emptyFilters),
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
            todayISO(resolveTimeZone(state.data, state.activeAccountId)),
            resolveWeekStart(state.data, state.activeAccountId),
          ),
        ),
      ),
    goToDate: (date) =>
      set((state) => recenterOn(state, startOfWeekISO(date, resolveWeekStart(state.data, state.activeAccountId)))),
    setDrawMode: (drawMode) => set((state) => ({ ui: { ...state.ui, drawMode } })),
    selectAllocation: (selectedAllocationId) => set((state) => ({ ui: { ...state.ui, selectedAllocationId } })),
    ...createFilterActions(set, emptyFilters),
    toggleGroup: (key) =>
      set((state) => ({
        ui: {
          ...state.ui,
          collapsedGroups: state.ui.collapsedGroups.includes(key)
            ? state.ui.collapsedGroups.filter((candidate) => candidate !== key)
            : [...state.ui.collapsedGroups, key],
        },
      })),
    ...createResourceJumpActions(set, emptyFilters),
  });
}
