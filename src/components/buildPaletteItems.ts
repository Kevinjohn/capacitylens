import type { useNavigate } from "react-router-dom";
import { buildEmptyFilters, type Filters } from "../store/useStore";
import type { useActiveScopedData } from "../store/useScopedData";
import { fuzzyFilter } from "../lib/fuzzy";
import { resolveResourceDisplayName } from "../lib/metadata";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { ADMIN_LINKS, LINKS } from "../lib/navLinks";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  section: string;
  onSelect: () => void;
}

// ─── Item builder ─────────────────────────────────────────────────────────────

const SECTION_LIMIT = 5; // max results per entity section

export function buildPaletteItems({
  query,
  data,
  disciplinesEnabled,
  placeholdersEnabled,
  externalEnabled,
  showInternalProjects,
  navigate,
  goToToday,
  goToDate,
  jumpToResource,
  setFilters,
  onClose,
}: {
  query: string;
  data: ReturnType<typeof useActiveScopedData>;
  disciplinesEnabled: boolean;
  placeholdersEnabled: boolean;
  externalEnabled: boolean;
  showInternalProjects: boolean;
  navigate: ReturnType<typeof useNavigate>;
  goToToday: () => void;
  goToDate: (iso: string) => void;
  jumpToResource: (id: string) => void;
  setFilters: (patch: Partial<Filters>) => void;
  onClose: () => void;
}): PaletteItem[] {
  const trimmedQuery = query.trim();
  const items: PaletteItem[] = [];

  // ── Actions ────────────────────────────────────────────────────────────────
  const actions: PaletteItem[] = [];

  // "Go to today" — always available in Actions
  actions.push({
    id: "action-today",
    label: m.palette_action_today(),
    section: m.palette_section_actions(),
    onSelect: () => {
      void navigate("/");
      goToToday();
      onClose();
    },
  });

  // "Go to date YYYY-MM-DD" — appears only when query is a valid ISO date
  if (isValidISODate(trimmedQuery)) {
    actions.push({
      id: `action-date-${trimmedQuery}`,
      label: m.palette_action_date({ date: trimmedQuery }),
      section: m.palette_section_actions(),
      onSelect: () => {
        void navigate("/");
        goToDate(trimmedQuery);
        onClose();
      },
    });
  }

  // Filter actions by query (fuzzy on label)
  const filteredActions = trimmedQuery
    ? fuzzyFilter(actions, trimmedQuery, (paletteItem) => paletteItem.label).slice(0, SECTION_LIMIT)
    : actions;

  // ── Pages ──────────────────────────────────────────────────────────────────
  // Derive page destinations from the same source as the sidebar navigation. New first-class
  // routes therefore cannot silently appear in navigation while being absent from the palette.
  // BOTH nav groups: the admin destinations (Team & access, Settings) are merely pinned to the
  // bottom of the sidebar (issues #169/#172) — they are still first-class routes, and dropping them
  // here would quietly remove the keyboard-only way to reach them.
  const pages: PaletteItem[] = [...LINKS, ...ADMIN_LINKS]
    .filter(({ to }) => disciplinesEnabled || to !== "/disciplines")
    .map(({ to, label }) => ({
      id: `page-${to === "/" ? "schedule" : to.slice(1)}`,
      label: label(),
      sublabel: to,
      section: m.palette_section_pages(),
      onSelect: () => {
        void navigate(to);
        onClose();
      },
    }));

  const filteredPages = trimmedQuery
    ? fuzzyFilter(pages, trimmedQuery, (project) => project.label).slice(0, SECTION_LIMIT)
    : pages;

  // ── Resources ──────────────────────────────────────────────────────────────
  // Placeholders and externals are each gated behind a per-account pref (both default OFF). When
  // off, drop them as jump targets — their schedule row is hidden, so jumping to it would scroll to
  // nothing.
  const resourceItems: PaletteItem[] = data.resources
    .filter((resource) => placeholdersEnabled || resource.kind !== "placeholder")
    .filter((resource) => externalEnabled || !isExternalResource(resource))
    .map((resource) => ({
      id: `res-${resource.id}`,
      // External / 3rd parties are jump targets too (they're schedule rows), but mark them so they
      // don't read as one of our own people in the list — mirrors the assignee dropdown's " (external)".
      // A placeholder reads as the literal "Placeholder" with its role as secondary text.
      label: `${resolveResourceDisplayName(resource)}${isExternalResource(resource) ? m.palette_resource_external_suffix() : ""}`,
      sublabel: resource.kind === "placeholder" ? resource.role : resource.name ? resource.role : undefined,
      section: m.palette_section_people(),
      onSelect: () => {
        void navigate("/");
        jumpToResource(resource.id);
        onClose();
      },
    }));

  const filteredResources = trimmedQuery
    ? fuzzyFilter(resourceItems, trimmedQuery, (row) => row.label).slice(0, SECTION_LIMIT)
    : resourceItems.slice(0, SECTION_LIMIT);

  // ── Projects ───────────────────────────────────────────────────────────────
  const clientsById = new Map(data.clients.map((client) => [client.id, client]));
  const projectItems: PaletteItem[] = data.projects
    .filter((project) => showInternalProjects || clientsById.get(project.clientId)?.builtin !== true)
    .map((project) => {
      const client = clientsById.get(project.clientId);
      return {
        id: `proj-${project.id}`,
        label: project.name,
        sublabel: client?.name,
        section: m.palette_section_projects(),
        onSelect: () => {
          void navigate("/");
          setFilters({ ...buildEmptyFilters(), projectId: project.id });
          onClose();
        },
      };
    });

  const filteredProjects = trimmedQuery
    ? fuzzyFilter(projectItems, trimmedQuery, (project) => project.label).slice(0, SECTION_LIMIT)
    : projectItems.slice(0, SECTION_LIMIT);

  // ── Clients ────────────────────────────────────────────────────────────────
  const clientItems: PaletteItem[] = data.clients.map((client) => ({
    id: `client-${client.id}`,
    label: client.name,
    section: m.palette_section_clients(),
    onSelect: () => {
      void navigate("/");
      setFilters({ ...buildEmptyFilters(), clientId: client.id });
      onClose();
    },
  }));

  const filteredClients = trimmedQuery
    ? fuzzyFilter(clientItems, trimmedQuery, (client) => client.label).slice(0, SECTION_LIMIT)
    : clientItems.slice(0, SECTION_LIMIT);

  // Activities open the management list, not a schedule bar. Keep internal activities searchable
  // even when their schedule-only visibility preference is off.
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const activityItems: PaletteItem[] = data.activities.map((activity) => {
    const project = activity.projectId ? projectsById.get(activity.projectId) : undefined;
    return {
      id: `activity-${activity.id}`,
      label: activity.name,
      // Project-specific activities show their project; project-less activities show their kind so the two
      // aren't indistinguishable blank-sublabel rows.
      sublabel:
        activity.kind === "project"
          ? project?.name
          : activity.kind === "internal"
            ? m.palette_activity_internal()
            : m.palette_activity_repeatable(),
      section: m.palette_section_activities(),
      onSelect: () => {
        void navigate(`/activities#activity=${encodeURIComponent(activity.id)}`);
        onClose();
      },
    };
  });

  const filteredActivities = trimmedQuery
    ? fuzzyFilter(activityItems, trimmedQuery, (paletteItem) => paletteItem.label).slice(0, SECTION_LIMIT)
    : activityItems.slice(0, SECTION_LIMIT);

  // ── Assemble ───────────────────────────────────────────────────────────────
  // When there's a query, only include sections that have results
  if (trimmedQuery) {
    if (filteredActions.length) items.push(...filteredActions);
    if (filteredPages.length) items.push(...filteredPages);
    if (filteredResources.length) items.push(...filteredResources);
    if (filteredProjects.length) items.push(...filteredProjects);
    if (filteredClients.length) items.push(...filteredClients);
    if (filteredActivities.length) items.push(...filteredActivities);
  } else {
    // No query: show Actions + Pages only
    items.push(...filteredActions);
    items.push(...filteredPages);
  }

  return items;
}
