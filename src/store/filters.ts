import type { ID } from "@capacitylens/shared/types/entities";

/** Schedule filters for discipline, work, search, and visibility preferences. */
export interface Filters {
  disciplineId: ID | null;
  clientId: ID | null;
  projectId: ID | null;
  /** Activity lens: a specific internal/all-projects activity. Mutually exclusive with the
   * client/project lens and with `activityKind` (enforced in setFilters). */
  activityId: ID | null;
  /** Activity lens: all activities of a kind ('Internal, All' / 'All projects, All'). Mutually
   * exclusive with the client/project lens and with `activityId`. */
  activityKind: "internal" | "repeatable" | null;
  search: string;
  hideTentative: boolean;
  /** When a client/project/activity filter is active, also show resources with no work on it
   * (dimmed) so you can see who's free to staff. Off (the default) = filtering
   * hides them, leaving only the matching resources' rows. */
  showUnmatched: boolean;
}

/** Create the default schedule filters with no active lens. */
export const buildEmptyFilters = (): Filters => ({
  disciplineId: null,
  clientId: null,
  projectId: null,
  activityId: null,
  activityKind: null,
  search: "",
  hideTentative: false,
  showUnmatched: false,
});

/** Clear entity lenses while preserving search and display preferences. */
export const clearEntityLenses = (filters: Filters): Filters => ({
  ...filters,
  disciplineId: null,
  clientId: null,
  projectId: null,
  activityId: null,
  activityKind: null,
});

/** Check whether the project/client lens is active; the activity lens is mutually exclusive. */
export function hasProjectClientLens(filters: Filters): boolean {
  return filters.projectId !== null || filters.clientId !== null;
}

/** Check whether a project/client or activity lens is active for the show-unmatched view. */
export function hasLensFilter(filters: Filters): boolean {
  return hasProjectClientLens(filters) || filters.activityId !== null || filters.activityKind !== null;
}

/** Check whether any filter changes the visible schedule. */
export function hasActiveFilters(filters: Filters): boolean {
  return hasLensFilter(filters) || !!filters.disciplineId || filters.search.trim() !== "" || filters.hideTentative;
}
