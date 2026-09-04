import type { ID } from "@capacitylens/shared/types/entities";

export interface Filters {
  disciplineId: ID | null;
  clientId: ID | null;
  projectId: ID | null;
  /** Activity lens: a specific internal/all-projects activity. Mutually exclusive with the
   *  client/project lens and with `activityKind` (enforced in setFilters). */
  activityId: ID | null;
  /** Activity lens: ALL activities of a kind ('Internal — All' / 'All projects — All'). Mutually
   *  exclusive with the client/project lens and with `activityId`. */
  activityKind: "internal" | "repeatable" | null;
  search: string;
  hideTentative: boolean;
  /** When a client/project/activity filter is active, ALSO show resources with no work on it
   *  (dimmed) so you can see who's free to staff. Off (the default) = filtering
   *  hides them, leaving only the matching resources' rows. */
  showUnmatched: boolean;
}

export const emptyFilters = (): Filters => ({
  disciplineId: null,
  clientId: null,
  projectId: null,
  activityId: null,
  activityKind: null,
  search: "",
  hideTentative: false,
  showUnmatched: false,
});

/** Drop the ENTITY lenses (discipline / client / project / activity) while leaving the text search
 *  and the tentative/unmatched view preferences exactly as the user set them. Used where new data
 *  arrives under the same tenant and the old lens ids no longer resolve. */
export const clearEntityLenses = (filters: Filters): Filters => ({
  ...filters,
  disciplineId: null,
  clientId: null,
  projectId: null,
  activityId: null,
  activityKind: null,
});

/** The project/client lens specifically — the pair that decides whether a bar "matches the filter"
 *  (the activity lens is standalone and mutually exclusive with it via setFilters). */
export function hasProjectClientLens(f: Filters): boolean {
  return !!(f.projectId || f.clientId);
}

/** Any "what work" lens is active — project/client OR activity. This is the gate for the dimmed
 *  show-unmatched staffing view, which behaves identically whichever of the two lenses is set. */
export function hasLensFilter(f: Filters): boolean {
  return hasProjectClientLens(f) || !!(f.activityId || f.activityKind);
}

export function hasActiveFilters(f: Filters): boolean {
  return hasLensFilter(f) || !!f.disciplineId || f.search.trim() !== "" || f.hideTentative;
}
