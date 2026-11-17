import { m } from '@/i18n';
import {
  applyCapacityMode,
  buildCapacityWindow,
  listTimeOffApplyingTo,
} from '@capacitylens/shared/lib/capacity';
import { effectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { isCapacityTracked } from '@capacitylens/shared/types/entities';
import type { AppData, ID, Weekday } from '@capacitylens/shared/types/entities';
import { resolveResourceDisplayName } from '@/lib/metadata';
import { listRenderableDateRanges } from '@/lib/renderableDateRanges';

/** The active company's planning rows and working week a gesture measures capacity against. */
export interface GestureCapacitySource {
  /** Active, scoped rows, as `buildActiveGestureData` returns them. */
  data: AppData;
  accountWorkingDays: Weekday[];
}

/** The visible span and scheduling mode a keyboard announcement measures over. */
export interface CapacityAnnouncementInput {
  source: GestureCapacitySource;
  resourceId: ID;
  visibleRange: { start: string; end: string };
  blocksMode: boolean;
}

/** A capacity-tracked resource's name and its over-capacity days in the measured window. */
export interface VisibleOverCapacity {
  name: string;
  overDays: number;
}

/**
 * Counts a resource's over-capacity days across its allocations, clamped to the visible range, from
 * the same visible-range capacity signal as the grid. Returns `undefined` for an unknown resource
 * or one whose capacity is not tracked.
 */
export function buildVisibleOverCapacity({
  source,
  resourceId,
  visibleRange,
  blocksMode,
}: CapacityAnnouncementInput): VisibleOverCapacity | undefined {
  const { data } = source;
  const resource = data.resources.find((candidate) => candidate.id === resourceId);
  if (!resource || !isCapacityTracked(resource)) return undefined;

  const name = resolveResourceDisplayName(resource);
  const allocations = applyCapacityMode({
    allocations: data.allocations.filter((allocation) => allocation.resourceId === resourceId),
    blocksMode: blocksMode,
  });
  const firstAllocation = allocations[0];
  if (!firstAllocation) return { name, overDays: 0 };
  let start = firstAllocation.startDate;
  let end = firstAllocation.endDate;
  for (const allocation of allocations) {
    if (allocation.startDate < start) start = allocation.startDate;
    if (allocation.endDate > end) end = allocation.endDate;
  }
  if (start < visibleRange.start) start = visibleRange.start;
  if (end > visibleRange.end) end = visibleRange.end;
  if (start > end) return { name, overDays: 0 };

  const timeOff = listTimeOffApplyingTo(resourceId, listRenderableDateRanges(data.timeOff));
  const overDays = buildCapacityWindow({
    resource: resource,
    allocations: allocations,
    timeOff: timeOff,
    start: start,
    end: end,
    effectiveWeek: effectiveWorkingWeek(resource, source.accountWorkingDays),
    closures: listRenderableDateRanges(data.closures),
  }).filter((day) => day.over).length;
  return { name, overDays };
}

/** Formats the screen-reader status for a measured resource; an unmeasured one is silent. */
export function formatCapacityAnnouncement(overCapacity: VisibleOverCapacity | undefined): string {
  if (!overCapacity) return '';
  const { name, overDays } = overCapacity;
  if (overDays === 0) return m.scheduler_sr_announce_clear({ name });
  return overDays === 1
    ? m.scheduler_sr_announce_over_one({ name, count: overDays })
    : m.scheduler_sr_announce_over_other({ name, count: overDays });
}

/** Builds the screen-reader status from the same visible-range capacity signal as the grid. */
export function buildCapacityAnnouncement(input: CapacityAnnouncementInput): string {
  return formatCapacityAnnouncement(buildVisibleOverCapacity(input));
}
