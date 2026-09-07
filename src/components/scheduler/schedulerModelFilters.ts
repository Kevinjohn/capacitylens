import { foldForSearch } from "../../lib/fuzzy";
import { resolveResourceDisplayName } from "../../lib/metadata";
import { hasLensFilter, type Filters } from "../../store/useStore";
import { effectiveProjectId } from "@capacitylens/shared/lib/integrity";
import { internalClientFor } from "@capacitylens/shared/data/internalClient";
import { isExternalResource, type Allocation, type AppData, type Resource } from "@capacitylens/shared/types/entities";
import type { SchedulerModelOptions } from "./schedulerModelTypes";

export function createAllocationFilters(
  filters: Filters,
  {
    disciplinesEnabled,
    placeholdersEnabled,
    externalEnabled,
    internalColourMode = "grey",
    showInternalProjects = true,
    showInternalActivities = true,
  }: SchedulerModelOptions["preferences"],
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
    internalColourMode,
  };
  // The built-in Internal client for the data being rendered (one per account; the data here is
  // already scoped to the active account, so every client shares that accountId). A project-less
  // activity DERIVES this as its client for display + filtering — without ever writing it onto the
  // activity (no activity.clientId field). If somehow absent (a partial/legacy blob), project-less
  // activities fall back to no client. Uses the SHARED `internalClientFor` predicate (the single
  // source of truth for "the account's builtin Internal") rather than an inline flag scan, so the
  // definition can't drift from migrate/import/server. The accountId comes from the scoped data
  // itself (all rows here belong to the active account); absent any client, there's no builtin.
  const scopedAccountId = data.clients[0]?.accountId;
  const internalClient = scopedAccountId ? internalClientFor(data.clients, scopedAccountId) : undefined;
  const resolveProjectClient = (allocation: Allocation) => {
    const activity = activitiesById.get(allocation.activityId);
    const projectId = effectiveProjectId(allocation, activity ?? {});
    const project = projectId ? projectsById.get(projectId) : undefined;
    // Project-less internal/repeatable work derives the built-in Internal client for display and
    // filtering only. A dangling activity or project reference must not be mistaken for
    // project-less work; allocation-owned attribution still resolves without an activity row.
    const client = projectId
      ? project
        ? clientsById.get(project.clientId)
        : undefined
      : activity
        ? internalClient
        : undefined;
    return { projectId, project, client };
  };
  // Does this allocation match the active project/client filter (ignoring tentative)?
  const hasMatchingProjectClient = (allocation: Allocation): boolean => {
    if (!filters.projectId && !filters.clientId) return true;
    const { projectId, client } = resolveProjectClient(allocation);
    if (filters.projectId && projectId !== filters.projectId) return false;
    if (filters.clientId && client?.id !== filters.clientId) return false;
    return true;
  };
  // The activity lens (standalone — mutually exclusive with project/client via setFilters): a
  // specific internal/all-projects activity, or a whole kind ('Internal — All' / 'All projects — All').
  const hasMatchingActivity = (allocation: Allocation): boolean => {
    if (filters.activityId) return allocation.activityId === filters.activityId;
    if (filters.activityKind) return activitiesById.get(allocation.activityId)?.kind === filters.activityKind;
    return true;
  };
  // Any "what work" filter is active — drives the dimmed / show-unmatched staffing view, which
  // is identical whether the active lens is client/project or activity.
  const workFilterActive = hasLensFilter(filters);
  const passesTentativeFilter = (allocation: Allocation): boolean =>
    !(filters.hideTentative && allocation.status === "tentative");
  const isAllocationVisible = (allocation: Allocation): boolean =>
    hasMatchingProjectClient(allocation) && hasMatchingActivity(allocation) && passesTentativeFilter(allocation);
  // Per-account BAR-ONLY visibility for internal work. CRITICAL PRODUCT DECISION: this filter is
  // applied ONLY when building `visibleAllocs` (bars + lane packing) — NEVER to `allAllocs`, which
  // feeds the capacity cache / utilisation below. Utilisation and capacity numbers MUST stay TRUTHFUL:
  // a person fully booked on internal work still shows as fully booked even when their internal bars
  // are hidden. Internal-project detection resolves each allocation's effective client through the
  // pre-built maps, so attributed repeatable work follows the target project's visibility.
  const isBarVisibleByInternalPreference = (allocation: Allocation): boolean => {
    const activity = activitiesById.get(allocation.activityId);
    if (!activity) return true; // dangling activityId — leave to the existing safe-fallback path
    // OWNER DECISION (revised 2026-08-19): internal, unattributed all-projects and client-project
    // work are distinct groups. Attributed all-projects work displays under its client project.
    if (!showInternalActivities && activity.kind === "internal") return false;
    if (!showInternalProjects) {
      const { project, client } = resolveProjectClient(allocation);
      if (project && client?.builtin === true) return false;
    }
    return true;
  };
  const isResourceVisible = (resource: Resource): boolean => {
    // Placeholders are gated behind a per-account pref (default OFF). Dropping the row here is the
    // single chokepoint that also removes its bars, day-states, and utilisation contribution — the
    // resource itself is untouched in the data, so this is a hide, not a delete. A placeholder's
    // allocations simply go unreferenced (the model is built resource-first via allocsByResource).
    if (!placeholdersEnabled && resource.kind === "placeholder") return false;
    // External / 3rd parties are gated behind their own per-account pref (default OFF), exactly
    // like placeholders. Dropping the row here empties the external band; the trailing
    // `rows.length > 0` filter then removes the band group so no empty header is drawn (risk #2).
    if (!externalEnabled && isExternalResource(resource)) return false;
    if (filteredDisciplineId && resource.disciplineId !== filteredDisciplineId) return false;
    // Search the DISPLAY name too, so a placeholder (shown as "Placeholder") is findable by what the
    // user sees — matching the command palette — as well as by its underlying role/name. Folding is
    // per-resource string work, so it runs only when there is actually a query to match.
    if (search) {
      const resourceSearchFields = [resolveResourceDisplayName(resource), resource.name, resource.role].map((field) =>
        foldForSearch(field ?? ""),
      );
      if (!resourceSearchFields.some((field) => field.includes(search))) return false;
    }
    return true;
  };

  return {
    resourceVisible: isResourceVisible,
    allocVisible: isAllocationVisible,
    notTentativeHidden: passesTentativeFilter,
    barVisibleByInternalPref: isBarVisibleByInternalPreference,
    workFilterActive,
    projectClientFor: resolveProjectClient,
    activityById: activitiesById,
    colorMaps,
  };
}
