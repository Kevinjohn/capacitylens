import { foldForSearch } from "@/lib/fuzzy";
import { resolveResourceDisplayName } from "@/lib/metadata";
import { hasLensFilter, type Filters } from "@/store/useStore";
import { internalClientFor } from "@capacitylens/shared/data/internalClient";
import { isExternalResource, type Allocation, type AppData, type Resource } from "@capacitylens/shared/types/entities";
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
  // Reused for every bar's colour (Internal-grey override, then project → client → resource → grey).
  const colorMaps = {
    activities: activitiesById,
    projects: projectsById,
    clients: clientsById,
    resources: resourcesById,
  };
  // The built-in Internal client for the data being rendered (one per account; the data here is
  // already scoped to the active account, so every client shares that accountId). A project-less
  // activity DERIVES this as its client for display + filtering, without ever writing it onto the
  // activity (no activity.clientId field). If somehow absent (a partial/legacy blob), project-less
  // activities fall back to no client. Uses the SHARED `internalClientFor` predicate (the single
  // source of truth for "the account's builtin Internal") rather than an inline flag scan, so the
  // definition can't drift from migrate/import/server. The accountId comes from the scoped data
  // itself (all rows here belong to the active account); absent any client, there's no builtin.
  const scopedAccountId = data.clients[0]?.accountId;
  const internalClient = scopedAccountId ? internalClientFor(data.clients, scopedAccountId) : undefined;
  const resolveProjectClient = (allocation: Allocation) =>
    buildAllocationAttribution({ allocation, activitiesById, projectsById, clientsById, internalClient });
  // Any "what work" filter is active, drives the dimmed / show-unmatched staffing view, which
  // is identical whether the active lens is client/project or activity.
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
