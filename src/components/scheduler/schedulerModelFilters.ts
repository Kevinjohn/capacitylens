import { foldForSearch } from "../../lib/fuzzy";
import { resourceDisplayName } from "../../lib/metadata";
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
    disciplinesEnabled && filters.disciplineId && data.disciplines.some((d) => d.id === filters.disciplineId)
      ? filters.disciplineId
      : null;
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const activityById = new Map(data.activities.map((act) => [act.id, act]));
  const resourceById = new Map(data.resources.map((r) => [r.id, r]));
  // Reused for every bar's colour (Internal-grey override, then project → client → resource → grey).
  const colorMaps = {
    activities: activityById,
    projects: projectById,
    clients: clientById,
    resources: resourceById,
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
  const projectClientFor = (allocation: Allocation) => {
    const activity = activityById.get(allocation.activityId);
    const projectId = effectiveProjectId(allocation, activity ?? {});
    const project = projectId ? projectById.get(projectId) : undefined;
    // Project-less internal/repeatable work derives the built-in Internal client for display and
    // filtering only. A dangling activity or project reference must not be mistaken for
    // project-less work; allocation-owned attribution still resolves without an activity row.
    const client = projectId
      ? project
        ? clientById.get(project.clientId)
        : undefined
      : activity
        ? internalClient
        : undefined;
    return { projectId, project, client };
  };
  // Does this allocation match the active project/client filter (ignoring tentative)?
  const matchesProjectClient = (a: Allocation): boolean => {
    if (!filters.projectId && !filters.clientId) return true;
    const { projectId, client } = projectClientFor(a);
    if (filters.projectId && projectId !== filters.projectId) return false;
    if (filters.clientId && client?.id !== filters.clientId) return false;
    return true;
  };
  // The activity lens (standalone — mutually exclusive with project/client via setFilters): a
  // specific internal/all-projects activity, or a whole kind ('Internal — All' / 'All projects — All').
  const matchesActivity = (a: Allocation): boolean => {
    if (filters.activityId) return a.activityId === filters.activityId;
    if (filters.activityKind) return activityById.get(a.activityId)?.kind === filters.activityKind;
    return true;
  };
  // Any "what work" filter is active — drives the dimmed / show-unmatched staffing view, which
  // is identical whether the active lens is client/project or activity.
  const workFilterActive = hasLensFilter(filters);
  const notTentativeHidden = (a: Allocation): boolean => !(filters.hideTentative && a.status === "tentative");
  const allocVisible = (a: Allocation): boolean =>
    matchesProjectClient(a) && matchesActivity(a) && notTentativeHidden(a);
  // Per-account BAR-ONLY visibility for internal work. CRITICAL PRODUCT DECISION: this filter is
  // applied ONLY when building `visibleAllocs` (bars + lane packing) — NEVER to `allAllocs`, which
  // feeds the capacity cache / utilisation below. Utilisation and capacity numbers MUST stay TRUTHFUL:
  // a person fully booked on internal work still shows as fully booked even when their internal bars
  // are hidden. Internal-project detection resolves each allocation's effective client through the
  // pre-built maps, so attributed repeatable work follows the target project's visibility.
  const barVisibleByInternalPref = (a: Allocation): boolean => {
    const activity = activityById.get(a.activityId);
    if (!activity) return true; // dangling activityId — leave to the existing safe-fallback path
    // OWNER DECISION (revised 2026-08-19): internal, unattributed all-projects and client-project
    // work are distinct groups. Attributed all-projects work displays under its client project.
    if (!showInternalActivities && activity.kind === "internal") return false;
    if (!showInternalProjects) {
      const { project, client } = projectClientFor(a);
      if (project && client?.builtin === true) return false;
    }
    return true;
  };
  const resourceVisible = (r: Resource): boolean => {
    // Placeholders are gated behind a per-account pref (default OFF). Dropping the row here is the
    // single chokepoint that also removes its bars, day-states, and utilisation contribution — the
    // resource itself is untouched in the data, so this is a hide, not a delete. A placeholder's
    // allocations simply go unreferenced (the model is built resource-first via allocsByResource).
    if (!placeholdersEnabled && r.kind === "placeholder") return false;
    // External / 3rd parties are gated behind their own per-account pref (default OFF), exactly
    // like placeholders. Dropping the row here empties the external band; the trailing
    // `rows.length > 0` filter then removes the band group so no empty header is drawn (risk #2).
    if (!externalEnabled && isExternalResource(r)) return false;
    if (filteredDisciplineId && r.disciplineId !== filteredDisciplineId) return false;
    // Search the DISPLAY name too, so a placeholder (shown as "Placeholder") is findable by what the
    // user sees — matching the command palette — as well as by its underlying role/name. Folding is
    // per-resource string work, so it runs only when there is actually a query to match.
    if (search) {
      const resourceSearchFields = [resourceDisplayName(r), r.name, r.role].map((field) => foldForSearch(field ?? ""));
      if (!resourceSearchFields.some((field) => field.includes(search))) return false;
    }
    return true;
  };

  return {
    resourceVisible,
    allocVisible,
    notTentativeHidden,
    barVisibleByInternalPref,
    workFilterActive,
    projectClientFor,
    activityById,
    colorMaps,
  };
}
