import { addDaysISO } from "@capacitylens/shared/lib/dateMath";
import { isCapacityTracked, isExternalResource } from "@capacitylens/shared/types/entities";
import type { AppData, Discipline, ID, Resource } from "@capacitylens/shared/types/entities";
import type { SchedulerUI } from "./types";

function isActiveSupplementary(resource: Resource): boolean {
  return resource.engagement === "supplementary" && isCapacityTracked(resource) && !resource.archivedAt;
}

/** Whether people are partitioned Studio then Supplementary in Resources, the schedule and
 * Overview. Derived, not stored: the split applies once any active, capacity-tracked resource is
 * Supplementary, so a Studio-only company reads as one list. Pass one company's resources. */
export function hasSupplementaryResources(resources: readonly Resource[]): boolean {
  return resources.some(isActiveSupplementary);
}

/** {@link hasSupplementaryResources} for the active company, read from the full store data. */
export function hasResourceEngagementGrouping(data: AppData, activeAccountId: ID | null): boolean {
  return data.resources.some((resource) => resource.accountId === activeAccountId && isActiveSupplementary(resource));
}

/** A discipline row and the resources displayed within its scheduler group. */
export interface DisciplineGroup {
  /** Null identifies the ungrouped resources bucket. */
  discipline: Discipline | null;
  resources: Resource[];
  /** True for the synthetic trailing group of external / 3rd-party resources, rendered as a
   * neutral band at the very bottom of the schedule (externals have no discipline to group by). */
  external?: boolean;
}

/** Orders scheduler disciplines by sortOrder, then display name and stable ID.
 * Management lists use alphabetical order for scanning instead.
 */
export const byDisciplineOrder = (a: Discipline, b: Discipline): number => {
  const orderDifference = a.sortOrder - b.sortOrder;
  if (orderDifference !== 0 || a.name === b.name) return orderDifference;
  return a.name < b.name ? -1 : 1;
};

/** The trailing external / 3rd-party band (neutral, always last), or null when there are none. The
 * one source for the partition so the disciplines-on (here) and disciplines-off (schedulerModel)
 * schedules can't disagree on where externals split off or how the band is shaped. */
export function buildExternalBand(resources: Resource[]): DisciplineGroup | null {
  const external = resources.filter(isExternalResource);
  return external.length ? { discipline: null, resources: external, external: true } : null;
}

/** Resources grouped by discipline (sorted), with an "ungrouped" bucket, then a trailing external
 * band last. External / 3rd-party resources are partitioned out of the discipline buckets entirely
 * so they always render as their own neutral band at the very bottom of the schedule. */
export function buildDisciplineGroups(data: AppData): DisciplineGroup[] {
  // Seed empty discipline buckets and partition resources once so large rosters are
  // not rescanned for every discipline. Unknown discipline IDs fall into the ungrouped bucket.
  const ours = data.resources.filter(isCapacityTracked);

  const resourcesByDisciplineId = new Map<ID, Resource[]>(data.disciplines.map((discipline) => [discipline.id, []]));
  const ungrouped: Resource[] = [];
  for (const resource of ours) {
    const bucket = resource.disciplineId ? resourcesByDisciplineId.get(resource.disciplineId) : undefined;
    (bucket ?? ungrouped).push(resource);
  }
  const sorted = [...data.disciplines].sort(byDisciplineOrder);
  const groups: DisciplineGroup[] = sorted.map((discipline) => ({
    discipline: discipline,
    resources: resourcesByDisciplineId.get(discipline.id) ?? [],
  }));
  if (ungrouped.length) groups.push({ discipline: null, resources: ungrouped });
  const band = buildExternalBand(data.resources);
  if (band) groups.push(band);
  return groups;
}

/** Calculate the date range currently shown by the scheduler. */
export function buildVisibleRange(schedulerUi: SchedulerUI): { start: string; end: string } {
  return { start: schedulerUi.originDate, end: addDaysISO(schedulerUi.originDate, schedulerUi.rangeDays - 1) };
}
