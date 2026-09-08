import { m } from "@/i18n";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { isExternalResource, type Activity } from "@capacitylens/shared/types/entities";
import type { useNavigate } from "react-router-dom";
import { fuzzyFilter } from "../lib/fuzzy";
import { resolveResourceDisplayName } from "../lib/metadata";
import { ADMIN_LINKS, LINKS } from "../lib/navLinks";
import type { useActiveScopedData } from "../store/useScopedData";
import { buildEmptyFilters, type Filters } from "../store/useStore";

export interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  section: string;
  onSelect: () => void;
}

interface BuildPaletteItemsInput {
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
}

const SECTION_LIMIT = 5;

function filterPaletteItems(items: PaletteItem[], query: string, showAllWithoutQuery = false): PaletteItem[] {
  if (!query) return showAllWithoutQuery ? items : items.slice(0, SECTION_LIMIT);
  return fuzzyFilter(items, query, (item) => item.label).slice(0, SECTION_LIMIT);
}

function buildActionItems({
  query,
  navigate,
  goToToday,
  goToDate,
  onClose,
}: BuildPaletteItemsInput & { query: string }) {
  const actions: PaletteItem[] = [
    {
      id: "action-today",
      label: m.palette_action_today(),
      section: m.palette_section_actions(),
      onSelect: () => {
        void navigate("/");
        goToToday();
        onClose();
      },
    },
  ];
  if (isValidISODate(query)) {
    actions.push({
      id: `action-date-${query}`,
      label: m.palette_action_date({ date: query }),
      section: m.palette_section_actions(),
      onSelect: () => {
        void navigate("/");
        goToDate(query);
        onClose();
      },
    });
  }
  return actions;
}

function buildPageItems({ disciplinesEnabled, navigate, onClose }: BuildPaletteItemsInput): PaletteItem[] {
  return [...LINKS, ...ADMIN_LINKS]
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
}

function buildResourceItems(input: BuildPaletteItemsInput): PaletteItem[] {
  const { data, placeholdersEnabled, externalEnabled, navigate, jumpToResource, onClose } = input;
  return data.resources
    .filter((resource) => placeholdersEnabled || resource.kind !== "placeholder")
    .filter((resource) => externalEnabled || !isExternalResource(resource))
    .map((resource) => ({
      id: `res-${resource.id}`,
      label: `${resolveResourceDisplayName(resource)}${isExternalResource(resource) ? m.palette_resource_external_suffix() : ""}`,
      ...(resource.kind === "placeholder" || resource.name ? { sublabel: resource.role } : {}),
      section: m.palette_section_people(),
      onSelect: () => {
        void navigate("/");
        jumpToResource(resource.id);
        onClose();
      },
    }));
}

function buildProjectItems(input: BuildPaletteItemsInput): PaletteItem[] {
  const { data, showInternalProjects, navigate, setFilters, onClose } = input;
  const clientsById = new Map(data.clients.map((client) => [client.id, client]));
  return data.projects
    .filter((project) => showInternalProjects || clientsById.get(project.clientId)?.builtin !== true)
    .map((project) => {
      const client = clientsById.get(project.clientId);
      return {
        id: `proj-${project.id}`,
        label: project.name,
        ...(client ? { sublabel: client.name } : {}),
        section: m.palette_section_projects(),
        onSelect: () => {
          void navigate("/");
          setFilters({ ...buildEmptyFilters(), projectId: project.id });
          onClose();
        },
      };
    });
}

function buildClientItems({ data, navigate, setFilters, onClose }: BuildPaletteItemsInput): PaletteItem[] {
  return data.clients.map((client) => ({
    id: `client-${client.id}`,
    label: client.name,
    section: m.palette_section_clients(),
    onSelect: () => {
      void navigate("/");
      setFilters({ ...buildEmptyFilters(), clientId: client.id });
      onClose();
    },
  }));
}

function resolveActivitySublabel(activity: Activity, projectName: string | undefined): string | undefined {
  if (activity.kind === "project") return projectName;
  if (activity.kind === "internal") return m.palette_activity_internal();
  return m.palette_activity_repeatable();
}

function buildActivityItems({ data, navigate, onClose }: BuildPaletteItemsInput): PaletteItem[] {
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  return data.activities.map((activity) => {
    const projectName = activity.projectId ? projectsById.get(activity.projectId)?.name : undefined;
    const sublabel = resolveActivitySublabel(activity, projectName);
    return {
      id: `activity-${activity.id}`,
      label: activity.name,
      ...(sublabel ? { sublabel } : {}),
      section: m.palette_section_activities(),
      onSelect: () => {
        void navigate(`/activities#activity=${encodeURIComponent(activity.id)}`);
        onClose();
      },
    };
  });
}

export function buildPaletteItems(input: BuildPaletteItemsInput): PaletteItem[] {
  const query = input.query.trim();
  const actions = filterPaletteItems(buildActionItems({ ...input, query }), query, true);
  const pages = filterPaletteItems(buildPageItems(input), query, true);
  if (!query) return [...actions, ...pages];
  return [
    actions,
    pages,
    filterPaletteItems(buildResourceItems(input), query),
    filterPaletteItems(buildProjectItems(input), query),
    filterPaletteItems(buildClientItems(input), query),
    filterPaletteItems(buildActivityItems(input), query),
  ].flat();
}
