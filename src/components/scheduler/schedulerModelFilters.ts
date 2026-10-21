import { foldForSearch } from "@/lib/fuzzy";
import { resolveResourceDisplayName } from "@/lib/metadata";
import { hasLensFilter } from "@/store/useStore";
import type { Filters } from "@/store/useStore";
import { internalClientFor } from "@capacitylens/shared/data/internalClient";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { Allocation, AppData, Resource } from "@capacitylens/shared/types/entities";
import type { SchedulerModelOptions } from "./schedulerModelTypes";
import { buildAllocationAttribution } from "./buildAllocationAttribution";

function createResourceVisibility({
  search,
  filteredDisciplineId,
  placeholdersEnabled,
  externalEnabled,
}: {
  search: string;
  filteredDisciplineId: string | null;
  placeholdersEnabled: boolean;
  externalEnabled: boolean;
}) {
  return (resource: Resource): boolean => {
    if (!placeholdersEnabled && resource.kind === "placeholder") return false;
    if (!externalEnabled && isExternalResource(resource)) return false;
    if (filteredDisciplineId && resource.disciplineId !== filteredDisciplineId) return false;
    if (!search) return true;
    const fields = [resolveResourceDisplayName(resource), resource.name, resource.role].map((field) =>
      foldForSearch(field ?? ""),
    );
    return fields.some((field) => field.includes(search));
  };
}

function createWorkVisibility({
  filters,
  activitiesById,
  resolveProjectClient,
}: {
  filters: Filters;
  activitiesById: Map<string, AppData["activities"][number]>;
  resolveProjectClient: (allocation: Allocation) => ReturnType<typeof buildAllocationAttribution>;
}) {
  const hasMatchingProjectClient = (allocation: Allocation): boolean => {
    if (!filters.projectId && !filters.clientId) return true;
    const { projectId, client } = resolveProjectClient(allocation);
    return (
      (!filters.projectId || projectId === filters.projectId) && (!filters.clientId || client?.id === filters.clientId)
    );
  };
  const hasMatchingActivity = (allocation: Allocation): boolean => {
    if (filters.activityId) return allocation.activityId === filters.activityId;
    if (filters.activityKind) return activitiesById.get(allocation.activityId)?.kind === filters.activityKind;
    return true;
  };
  const passesTentativeFilter = (allocation: Allocation): boolean =>
    !(filters.hideTentative && allocation.status === "tentative");
  return {
    allocVisible: (allocation: Allocation) =>
      hasMatchingProjectClient(allocation) && hasMatchingActivity(allocation) && passesTentativeFilter(allocation),
    notTentativeHidden: passesTentativeFilter,
  };
}

/** Builds predicates for the active schedule filters and resource visibility. */
export function createAllocationFilters(
  filters: Filters,
  { disciplinesEnabled, placeholdersEnabled, externalEnabled }: SchedulerModelOptions["preferences"],
  data: AppData,
) {
  // Same diacritic-insensitive fold the fuzzy matcher uses, so typing "Jose" finds "José" whether
  // the query lands here or in a command palette.
  const search = foldForSearch(filters.search.trim());
  // A stale discipline filter can survive deleting the final discipline. It must not make the
  // engagement fallback look empty; only a filter that still resolves to a real discipline applies.
  const filteredDisciplineId =
    disciplinesEnabled &&
    filters.disciplineId &&
    data.disciplines.some((discipline) => discipline.id === filters.disciplineId)
      ? filters.disciplineId
      : null;
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const clientsById = new Map(data.clients.map((client) => [client.id, client]));
  const activitiesById = new Map(data.activities.map((activity) => [activity.id, activity]));
  const resourcesById = new Map(data.resources.map((resource) => [resource.id, resource]));

  const colorMaps = {
    activities: activitiesById,
    projects: projectsById,
    clients: clientsById,
    resources: resourcesById,
  };
  // Project-less internal work derives its client from the scoped account's built-in Internal row. Do not persist that derived attribution; if the row is missing, leave the client absent.
  const scopedAccountId = data.clients[0]?.accountId;
  const internalClient = scopedAccountId ? internalClientFor(data.clients, scopedAccountId) : undefined;
  const resolveProjectClient = (allocation: Allocation) =>
    buildAllocationAttribution({ allocation, activitiesById, projectsById, clientsById, internalClient });

  const workFilterActive = hasLensFilter(filters);
  const workVisibility = createWorkVisibility({ filters, activitiesById, resolveProjectClient });
  const isResourceVisible = createResourceVisibility({
    search,
    filteredDisciplineId,
    placeholdersEnabled,
    externalEnabled,
  });
  return {
    resourceVisible: isResourceVisible,
    ...workVisibility,
    workFilterActive,
    projectClientFor: resolveProjectClient,
    activityById: activitiesById,
    colorMaps,
  };
}
