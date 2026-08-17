import { startOfWeekISO, todayISO } from "@capacitylens/shared/lib/dateMath";
import type { ID, ISODate, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { compareDisplayNames } from "../../lib/displayOrder";
import { resourceDisplayName } from "../../lib/metadata";
import { m } from "@/i18n";

/** One heading and its ordered, currently relevant time-off entries. */
export type TimeOffGroup =
  | { kind: "resource"; resourceId: ID; name: string; entries: TimeOff[] }
  | { kind: "unknown"; name: string; entries: TimeOff[] };

/** Resolve the active company's current week boundary from its own calendar settings. */
export function currentTimeOffWeekStart(timeZone: string, weekStartsOn: 0 | 1): ISODate {
  return startOfWeekISO(todayISO(timeZone), weekStartsOn);
}

const compareEntries = (left: TimeOff, right: TimeOff): number =>
  left.startDate.localeCompare(right.startDate) ||
  left.endDate.localeCompare(right.endDate) ||
  left.id.localeCompare(right.id);

/**
 * Build the Time off page's forward-looking grouped projection without mutating stored data.
 * Entries remain visible when they overlap the current week boundary; missing resource references
 * collect in one final fallback group so corrupt legacy data cannot crash or silently disappear.
 */
export function buildTimeOffGroups(
  timeOff: readonly TimeOff[],
  resources: readonly Resource[],
  weekStart: ISODate,
  placeholdersEnabled: boolean,
): TimeOffGroup[] {
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  const byResource = new Map<ID, Extract<TimeOffGroup, { kind: "resource" }>>();
  let unknown: Extract<TimeOffGroup, { kind: "unknown" }> | null = null;

  for (const entry of timeOff) {
    if (entry.endDate < weekStart) continue;
    const resource = resourceById.get(entry.resourceId);
    if (resource?.kind === "placeholder" && !placeholdersEnabled) continue;

    if (!resource) {
      unknown ??= { kind: "unknown", name: m.list_timeoff_unknown_resource(), entries: [] };
      unknown.entries.push(entry);
      continue;
    }

    let group = byResource.get(resource.id);
    if (!group) {
      group = { kind: "resource", resourceId: resource.id, name: resourceDisplayName(resource), entries: [] };
      byResource.set(resource.id, group);
    }
    group.entries.push(entry);
  }

  const resourceGroups = [...byResource.values()].sort((left, right) =>
    compareDisplayNames(left.name, left.resourceId, right.name, right.resourceId),
  );
  const groups: TimeOffGroup[] = [];
  for (const group of resourceGroups) {
    group.entries.sort(compareEntries);
    groups.push(group);
  }
  if (unknown) {
    unknown.entries.sort(compareEntries);
    groups.push(unknown);
  }
  return groups;
}
