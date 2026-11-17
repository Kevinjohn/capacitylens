import { blockHoursPerDay } from '@capacitylens/shared/lib/schedulingDays';
import type { DateRange } from '@/lib/gestureMath';
import type { BarLayout } from './schedulerModel';
import { m } from '@/i18n';
import {
  buildCapacityAdvisory,
  applyCapacityMode,
  listTimeOffApplyingTo,
} from '@capacitylens/shared/lib/capacity';
import type { CapacitySection } from '@capacitylens/shared/lib/capacity';
import { eachDayISO } from '@capacitylens/shared/lib/dateMath';
import { formatCapacityAdvisory } from '@/lib/capacity/advisoryCopy';
import { effectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { FULL_DAY_HOURS, isCapacityTracked } from '@capacitylens/shared/types/entities';
import type { AppData, ID, Resource, Weekday } from '@capacitylens/shared/types/entities';
import { resolveResourceDisplayName } from '@/lib/metadata';
import { listRenderableDateRanges } from '@/lib/renderableDateRanges';
import { readServerDayCapacity } from './schedulerRowCapacity';

/** The active company's planning rows and working week a gesture measures capacity against. */
export interface GestureCapacitySource {
  /** Active, scoped rows, as `buildActiveGestureData` returns them. */
  data: AppData;
  accountWorkingDays: Weekday[];
}

/** The server's capacity figures and the visible span a keyboard announcement counts over. */
export interface CapacityAnnouncementInput {
  resources: Resource[];
  capacity: CapacitySection | null;
  resourceId: ID;
  visibleRange: { start: string; end: string };
}

/** A capacity-tracked resource's name and its over-capacity days in the measured window. */
export interface VisibleOverCapacity {
  name: string;
  overDays: number;
}

interface BuildCapacityGestureAdvisoryInput {
  source: GestureCapacitySource;
  bar: BarLayout;
  effectiveResourceId: ID;
  isBlocks: boolean;
  dates: DateRange;
  reconciledHours: number;
}

/**
 * Counts a resource's over-capacity days in the visible range from the server's figures, the same
 * figures the grid draws. A date the server has not sent counts as not over. Returns `undefined`
 * for an unknown resource or one whose capacity is not tracked.
 */
export function buildVisibleOverCapacity({
  resources,
  capacity,
  resourceId,
  visibleRange,
}: CapacityAnnouncementInput): VisibleOverCapacity | undefined {
  const resource = resources.find((candidate) => candidate.id === resourceId);
  if (!resource || !isCapacityTracked(resource)) return undefined;
  const overDays = eachDayISO(visibleRange.start, visibleRange.end).filter(
    (date) => readServerDayCapacity(capacity, resourceId, date)?.over === true,
  ).length;
  return { name: resolveResourceDisplayName(resource), overDays };
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

/** Builds the screen-reader status from the server's figures for the visible range. */
export function buildCapacityAnnouncement(input: CapacityAnnouncementInput): string {
  return formatCapacityAnnouncement(buildVisibleOverCapacity(input));
}

/** Builds the capacity warning associated with a proposed bar gesture, or `''` when there is none. */
export function buildCapacityGestureAdvisory({
  source,
  bar,
  effectiveResourceId,
  isBlocks,
  dates,
  reconciledHours,
}: BuildCapacityGestureAdvisoryInput) {
  const { data } = source;
  const resource = data.resources.find((candidate) => candidate.id === effectiveResourceId);
  let advisory = '';
  if (resource && isCapacityTracked(resource)) {
    const others = applyCapacityMode({
      allocations: data.allocations.filter(
        (allocation) =>
          allocation.resourceId === effectiveResourceId && allocation.id !== bar.allocation.id,
      ),
      blocksMode: isBlocks,
    });
    const timeOff = listTimeOffApplyingTo(
      effectiveResourceId,
      listRenderableDateRanges(data.timeOff),
    );
    const result = buildCapacityAdvisory({
      resource: resource,
      proposal: {
        resourceId: effectiveResourceId,
        startDate: dates.startDate,
        endDate: dates.endDate,
        // Use the shared blocks-load projection so gesture warnings match the grid even when stored allocations carry hourly values.
        hoursPerDay: isBlocks ? blockHoursPerDay(FULL_DAY_HOURS) : reconciledHours,
        ignoreWorkingDays: bar.allocation.ignoreWorkingDays,
      },
      otherAllocations: others,
      timeOff: timeOff,
      effectiveWeek: effectiveWorkingWeek(resource, source.accountWorkingDays),
      closures: listRenderableDateRanges(data.closures),
    });
    advisory = formatCapacityAdvisory(result, 'toast');
  }
  return advisory;
}
