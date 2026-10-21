import type { AppData, ID } from "@capacitylens/shared/types/entities";

// Pure derived-state helpers. Components call these inside useMemo (keyed on the
// relevant slice) so Zustand selectors never return fresh objects directly,
// avoiding the useSyncExternalStore re-render trap.

/** List allocations assigned to one resource. */
export const listResourceAllocations = (data: AppData, resourceId: ID) =>
  data.allocations.filter((allocation) => allocation.resourceId === resourceId);

// These helpers search only the supplied account-scoped data and can miss stale IDs. Callers must
// narrow the result before dereferencing it.
/** Find an activity by its stable ID. */
export const activityById = (data: AppData, id: ID) => data.activities.find((activity) => activity.id === id);
/** Find a project by its stable ID. */
export const projectById = (data: AppData, id: ID) => data.projects.find((project) => project.id === id);
/** Find a client by its stable ID. */
export const clientById = (data: AppData, id: ID) => data.clients.find((client) => client.id === id);
/** Find a resource by its stable ID. */
export const resourceById = (data: AppData, id: ID) => data.resources.find((resource) => resource.id === id);
