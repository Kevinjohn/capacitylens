import { isExternalResource } from "../types/entities";
import { effectiveProjectId } from "./integrity";
import type { Allocation, Client, ID, Project, Resource, Activity } from "../types/entities";
import { NEUTRAL_COLOR } from "./colorPalette";

/** Id→entity maps for O(1) colour resolution. The scheduler model already builds
 * these to position bars, so colour resolution reuses them instead of re-scanning
 * the raw arrays once per bar. */
export interface BarColorMaps {
  activities: Map<ID, Activity>;
  projects: Map<ID, Project>;
  clients: Map<ID, Client>;
  resources: Map<ID, Resource>;
}

/** Resolve a project's displayed colour without mutating its saved palette choice. Internal-owned
 * projects always read as neutral grey; their stored colour is kept but not shown. */
export function resolveProjectColor(project: Project, client: Client | undefined): string {
  return client?.builtin === true ? NEUTRAL_COLOR : project.color;
}

interface BarAttribution {
  activity: Activity | undefined;
  project: Project | undefined;
  client: Client | undefined;
}

function resolveBarAttribution(allocation: Allocation, maps: BarColorMaps): BarAttribution {
  const activity = maps.activities.get(allocation.activityId);
  const projectId = effectiveProjectId(allocation, activity ?? {});
  const project = projectId ? maps.projects.get(projectId) : undefined;
  return {
    activity,
    project,
    client: project ? maps.clients.get(project.clientId) : undefined,
  };
}

function hasNeutralBarColor(attribution: BarAttribution): boolean {
  return attribution.activity?.kind === "internal" || attribution.client?.builtin === true;
}

/** Resolve an allocation bar colour. External work is always grey, and so are `internal` activities
 * and allocations whose effective project is Internal-owned; otherwise bars use project → client →
 * resource → neutral fallback order. */
export function resolveBarColor(allocation: Allocation, maps: BarColorMaps): string {
  const resource = maps.resources.get(allocation.resourceId);
  // External / 3rd-party work reads as a single neutral colour (an "awareness" signal),
  // overriding the usual project→client colouring so an outsourced bar never looks like one of
  // our own. See DECISIONS.md "external kind": single neutral colour.
  if (resource && isExternalResource(resource)) return NEUTRAL_COLOR;
  const attribution = resolveBarAttribution(allocation, maps);
  if (hasNeutralBarColor(attribution)) return NEUTRAL_COLOR;
  if (attribution.project?.color) return attribution.project.color;
  if (attribution.client?.color) return attribution.client.color;

  return resource?.color ?? NEUTRAL_COLOR;
}
