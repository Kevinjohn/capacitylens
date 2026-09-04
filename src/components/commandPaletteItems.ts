import type { useNavigate } from "react-router-dom";
import { emptyFilters, type Filters } from "../store/useStore";
import type { useActiveScopedData } from "../store/useScopedData";
import { fuzzyFilter } from "../lib/fuzzy";
import { resourceDisplayName } from "../lib/metadata";
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

export function buildItems({
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
  const q = query.trim();
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
  if (isValidISODate(q)) {
    actions.push({
      id: `action-date-${q}`,
      label: m.palette_action_date({ date: q }),
      section: m.palette_section_actions(),
      onSelect: () => {
        void navigate("/");
        goToDate(q);
        onClose();
      },
    });
  }

  // Filter actions by query (fuzzy on label)
  const filteredActions = q ? fuzzyFilter(actions, q, (a) => a.label).slice(0, SECTION_LIMIT) : actions;

  // ── Pages ──────────────────────────────────────────────────────────────────
  // Derive page destinations from the same source as the sidebar navigation. New first-class
  // routes therefore cannot silently appear in navigation while being absent from the palette.
  // BOTH nav groups: the admin destinations (Team & access, Settings) are merely pinned to the
  // bottom of the sidebar (issues #169/#172) — they are still first-class routes, and dropping them
  // here would quietly remove the keyboard-only way to reach them.
  const pages: PaletteItem[] = [...LINKS, ...ADMIN_LINKS]
    .filter(([to]) => disciplinesEnabled || to !== "/disciplines")
    .map(([to, label]) => ({
      id: `page-${to === "/" ? "schedule" : to.slice(1)}`,
      label: label(),
      sublabel: to,
      section: m.palette_section_pages(),
      onSelect: () => {
        void navigate(to);
        onClose();
      },
    }));

  const filteredPages = q ? fuzzyFilter(pages, q, (p) => p.label).slice(0, SECTION_LIMIT) : pages;

  // ── Resources ──────────────────────────────────────────────────────────────
  // Placeholders and externals are each gated behind a per-account pref (both default OFF). When
  // off, drop them as jump targets — their schedule row is hidden, so jumping to it would scroll to
  // nothing.
  const resourceItems: PaletteItem[] = data.resources
    .filter((r) => placeholdersEnabled || r.kind !== "placeholder")
    .filter((r) => externalEnabled || !isExternalResource(r))
    .map((r) => ({
      id: `res-${r.id}`,
      // External / 3rd parties are jump targets too (they're schedule rows), but mark them so they
      // don't read as one of our own people in the list — mirrors the assignee dropdown's " (external)".
      // A placeholder reads as the literal "Placeholder" with its role as secondary text.
      label: `${resourceDisplayName(r)}${isExternalResource(r) ? m.palette_resource_external_suffix() : ""}`,
      sublabel: r.kind === "placeholder" ? r.role : r.name ? r.role : undefined,
      section: m.palette_section_people(),
      onSelect: () => {
        void navigate("/");
        jumpToResource(r.id);
        onClose();
      },
    }));

  const filteredResources = q
    ? fuzzyFilter(resourceItems, q, (r) => r.label).slice(0, SECTION_LIMIT)
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
          setFilters({ ...emptyFilters(), projectId: project.id });
          onClose();
        },
      };
    });

  const filteredProjects = q
    ? fuzzyFilter(projectItems, q, (p) => p.label).slice(0, SECTION_LIMIT)
    : projectItems.slice(0, SECTION_LIMIT);

  // ── Clients ────────────────────────────────────────────────────────────────
  const clientItems: PaletteItem[] = data.clients.map((c) => ({
    id: `client-${c.id}`,
    label: c.name,
    section: m.palette_section_clients(),
    onSelect: () => {
      void navigate("/");
      setFilters({ ...emptyFilters(), clientId: c.id });
      onClose();
    },
  }));

  const filteredClients = q
    ? fuzzyFilter(clientItems, q, (c) => c.label).slice(0, SECTION_LIMIT)
    : clientItems.slice(0, SECTION_LIMIT);

  // Activities open the management list, not a schedule bar. Keep internal activities searchable
  // even when their schedule-only visibility preference is off.
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const activityItems: PaletteItem[] = data.activities.map((a) => {
    const project = a.projectId ? projectsById.get(a.projectId) : undefined;
    return {
      id: `activity-${a.id}`,
      label: a.name,
      // Project-specific activities show their project; project-less activities show their kind so the two
      // aren't indistinguishable blank-sublabel rows.
      sublabel:
        a.kind === "project"
          ? project?.name
          : a.kind === "internal"
            ? m.palette_activity_internal()
            : m.palette_activity_repeatable(),
      section: m.palette_section_activities(),
      onSelect: () => {
        void navigate(`/activities#activity=${encodeURIComponent(a.id)}`);
        onClose();
      },
    };
  });

  const filteredActivities = q
    ? fuzzyFilter(activityItems, q, (a) => a.label).slice(0, SECTION_LIMIT)
    : activityItems.slice(0, SECTION_LIMIT);

  // ── Assemble ───────────────────────────────────────────────────────────────
  // When there's a query, only include sections that have results
  if (q) {
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
