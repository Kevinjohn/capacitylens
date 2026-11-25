import { m } from '@/i18n';
import type { CapacitySection } from '@capacitylens/shared/lib/capacity';
import { listDaysISO } from '@capacitylens/shared/lib/dateMath';
import { isCapacityTracked } from '@capacitylens/shared/types/entities';
import type { ID, Resource } from '@capacitylens/shared/types/entities';
import { resolveResourceDisplayName } from '@/lib/metadata';
import { readServerDayCapacity } from './schedulerRowCapacity';

/** The server's capacity figures and the visible span a keyboard announcement counts over. */
interface CapacityAnnouncementInput {
  resources: Resource[];
  capacity: CapacitySection | null;
  resourceId: ID;
  visibleRange: { start: string; end: string };
}

/** A capacity-tracked resource's name and its over-capacity days in the measured window. */
interface VisibleOverCapacity {
  name: string;
  overDays: number;
}

/**
 * Counts a resource's over-capacity days in the visible range from the server's figures, the same
 * figures the grid draws. A date the server has not sent counts as not over. Returns `undefined`
 * for an unknown resource or one whose capacity is not tracked.
 */
function buildVisibleOverCapacity({
  resources,
  capacity,
  resourceId,
  visibleRange,
}: CapacityAnnouncementInput): VisibleOverCapacity | undefined {
  const resource = resources.find((candidate) => candidate.id === resourceId);
  if (!resource || !isCapacityTracked(resource)) return undefined;
  const overDays = listDaysISO(visibleRange.start, visibleRange.end).filter(
    (date) => readServerDayCapacity(capacity, resourceId, date)?.over === true,
  ).length;
  return { name: resolveResourceDisplayName(resource), overDays };
}

/** Formats the screen-reader status for a measured resource; an unmeasured one is silent. */
function formatCapacityAnnouncement(overCapacity: VisibleOverCapacity | undefined): string {
  if (!overCapacity) return '';
  const { name, overDays } = overCapacity;
  if (overDays === 0) return m.scheduler_sr_announce_clear({ name });
  return overDays === 1
    ? m.scheduler_sr_announce_over_one({ name, count: overDays })
    : m.scheduler_sr_announce_over_other({ name, count: overDays });
}

/** Builds the screen-reader status from the server's figures for the visible range. */
export function buildCapacityAnnouncement(input: CapacityAnnouncementInput): string {
  return formatCapacityAnnouncement(buildVisibleOverCapacity(input));
}
