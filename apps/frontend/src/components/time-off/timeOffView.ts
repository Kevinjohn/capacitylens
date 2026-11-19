import type { Closure, ID, ISODate, Resource, TimeOff } from '@capacitylens/shared/types/entities';
import { compareDisplayNames } from '@/lib/displayOrder';
import { resolveResourceDisplayName } from '@/lib/metadata';
import { isResourceKindEnabled } from '@/lib/resourceGrouping';
import { m } from '@/i18n';

interface BuildTimeOffGroupsInput {
  timeOff: readonly TimeOff[];
  resources: readonly Resource[];
  weekStart: ISODate;
  placeholdersEnabled: boolean;
}

/** One heading and its ordered, currently relevant time-off entries. */
export type TimeOffGroup =
  | { kind: 'resource'; resourceId: ID; name: string; entries: TimeOff[] }
  | { kind: 'unknown'; name: string; entries: TimeOff[] };

const compareEntries = (left: TimeOff, right: TimeOff): number =>
  left.startDate.localeCompare(right.startDate) ||
  left.endDate.localeCompare(right.endDate) ||
  left.id.localeCompare(right.id);

/** Forward-looking company closures, ordered by their literal inclusive spans. */
export function buildClosureList(closures: readonly Closure[], weekStart: ISODate): Closure[] {
  return closures
    .filter((closure) => closure.endDate >= weekStart)
    .toSorted(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) ||
        left.endDate.localeCompare(right.endDate) ||
        left.id.localeCompare(right.id),
    );
}

/**
 * Build the Time off page's forward-looking grouped projection without mutating stored data.
 * Entries remain visible when they overlap the current week boundary; missing resource references
 * collect in one final fallback group so corrupt data cannot crash or silently disappear.
 */
export function buildTimeOffGroups({
  timeOff,
  resources,
  weekStart,
  placeholdersEnabled,
}: BuildTimeOffGroupsInput): TimeOffGroup[] {
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const byResource = new Map<ID, Extract<TimeOffGroup, { kind: 'resource' }>>();
  let unknown: Extract<TimeOffGroup, { kind: 'unknown' }> | null = null;

  for (const entry of timeOff) {
    if (entry.endDate < weekStart) continue;
    const resource = resourcesById.get(entry.resourceId);
    // External parties cannot hold time off, so only the placeholder switch can hide an entry here.
    if (
      resource &&
      !isResourceKindEnabled(resource, { placeholdersEnabled, externalEnabled: true })
    ) {
      continue;
    }

    if (!resource) {
      unknown ??= { kind: 'unknown', name: m.list_time_off_unknown_resource(), entries: [] };
      unknown.entries.push(entry);
      continue;
    }

    let group = byResource.get(resource.id);
    if (!group) {
      group = {
        kind: 'resource',
        resourceId: resource.id,
        name: resolveResourceDisplayName(resource),
        entries: [],
      };
      byResource.set(resource.id, group);
    }
    group.entries.push(entry);
  }

  const resourceGroups = [...byResource.values()].sort((left, right) =>
    compareDisplayNames({
      leftName: left.name,
      leftId: left.resourceId,
      rightName: right.name,
      rightId: right.resourceId,
    }),
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
