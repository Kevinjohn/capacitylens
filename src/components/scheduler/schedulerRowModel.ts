import { laneTop, packLanes, rowHeightForLanes } from "../../lib/lanePacking";
import { isHalfDay } from "../../lib/capacity";
import { rangesOverlap, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { resolveBarColor } from "@capacitylens/shared/lib/color";
import { timeOffTypeLabel } from "../../lib/metadata";
import {
  isExternalResource,
  type Allocation,
  type ID,
  type ISODate,
  type Resource,
  type TimeOff,
} from "@capacitylens/shared/types/entities";
import { isCreationStartBlockedForEffectiveWeek } from "./creationAvailability";
import { hasRenderableDateRange } from "./schedulerModelIndexing";
import type { createAllocationFilters } from "./schedulerModelFilters";
import type { createCapacitySource } from "./schedulerRowCapacity";
import type { BarLayout, DayState, RowModel, SchedulerModelOptions, TimeOffBlock } from "./schedulerModelTypes";

export function createRowBuilder(
  { data, geom, days }: Pick<SchedulerModelOptions, "data" | "geom" | "days">,
  accountWorkingDays: NonNullable<SchedulerModelOptions["preferences"]["accountWorkingDays"]>,
  blocksMode: boolean,
  laneLayout: NonNullable<SchedulerModelOptions["laneLayout"]>,
  allocsByResource: Map<ID, Allocation[]>,
  timeOffByResource: Map<ID, TimeOff[]>,
  seriesEndByKey: Map<string, ISODate>,
  {
    allocVisible,
    notTentativeHidden,
    barVisibleByInternalPref,
    workFilterActive,
    projectClientFor,
    activityById,
    colorMaps,
  }: ReturnType<typeof createAllocationFilters>,
  { capacitySourceFor, visDays, overDays }: ReturnType<typeof createCapacitySource>,
) {
  const timelineStart = days[0];
  const timelineEnd = days[days.length - 1];
  const intersectsTimeline = (row: { startDate: ISODate; endDate: ISODate }) =>
    timelineStart !== undefined &&
    timelineEnd !== undefined &&
    rangesOverlap(row.startDate, row.endDate, timelineStart, timelineEnd);

  const timeOffBlockFor = (t: TimeOff): TimeOffBlock => ({
    id: t.id,
    x: geom.xForDateInGeom(t.startDate),
    width: geom.widthForDates(t.startDate, t.endDate),
    label: timeOffTypeLabel(t.type),
    note: t.note,
  });
  const NO_TIME_OFF_BLOCKS: TimeOffBlock[] = [];

  return function buildRow(resource: Resource): RowModel {
    // This resource's data, pre-grouped above; capacity then scans only its own
    // allocations/time-off, not the whole dataset per day (was O(res×days×allocs)).
    const allAllocs = (allocsByResource.get(resource.id) ?? []).filter(hasRenderableDateRange);
    const resTimeOff = timeOffByResource.get(resource.id) ?? [];
    const isExternal = isExternalResource(resource);
    // Resolve the company/personal intersection once for the whole row. Capacity, creation
    // blocking, visible utilisation and overSoon all reuse this discriminated result.
    const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
    // A row is "dimmed" when a work filter (client/project OR the activity lens) is active and
    // this resource has NO MATCHING BAR in the displayed timeline — we still show their full
    // real load (so you can see who's free to staff), just visually de-emphasised. Deriving this
    // from the exact matching bar set means off-timeline and otherwise hidden matches cannot
    // create a full-opacity, zero-bar "ghost" row that escapes the show-unmatched filter.
    const matchingVisibleAllocs = allAllocs
      .filter(allocVisible)
      .filter(intersectsTimeline)
      .filter(barVisibleByInternalPref);
    const dimmed = workFilterActive && matchingVisibleAllocs.length === 0;
    const visibleAllocs = dimmed
      ? allAllocs
          .filter(notTentativeHidden)
          .filter(intersectsTimeline)
          // BAR-ONLY internal-work hide (see barVisibleByInternalPref). Applied here, after the
          // capacity path has already taken `allAllocs`, so hiding an internal bar never changes
          // the resource's utilisation/capacity — only which bars render.
          .filter(barVisibleByInternalPref)
      : matchingVisibleAllocs;
    const { lanes, laneCount } = packLanes(visibleAllocs);
    const laneById = new Map(lanes.map((l) => [l.id, l.lane]));
    const bars: BarLayout[] = visibleAllocs.map((a) => {
      const { project, client } = projectClientFor(a);
      return {
        allocation: a,
        x: geom.xForDateInGeom(a.startDate),
        width: geom.widthForDates(a.startDate, a.endDate),
        top: laneTop(laneById.get(a.id) ?? 0, laneLayout),
        color: resolveBarColor(a, colorMaps),
        label: activityById.get(a.activityId)?.name ?? "Activity",
        project: project?.name,
        client: client?.name,
        seriesEnd: a.seriesId ? seriesEndByKey.get(`${a.accountId}\u0000${a.seriesId}`) : undefined,
        external: isExternal,
      };
    });
    const capacity = capacitySourceFor(resource, allAllocs, resTimeOff, effectiveWeek);
    const dayStates: DayState[] = [];
    let conflictDayCount = 0;
    let partialCapacityDayCount = 0;
    for (const date of days) {
      const cap = capacity.capacityOnDay(date);
      // Company-closed dates still receive the shared unavailable tint on EVERY row, starved
      // or not, because allocation creation is blocked there for everyone. The per-date
      // bucket keeps this O(coverage) instead of rescanning the full row list each day.
      const creationBlocked = isCreationStartBlockedForEffectiveWeek(
        resource,
        date,
        capacity.timeOffOn(date),
        effectiveWeek,
        data.closures,
      );
      const unavailable = (capacity.tracked && cap.available === 0) || creationBlocked;
      const partialCapacity = capacity.tracked && !unavailable && isHalfDay(resource, weekdayOf(date));
      const hasTimeOff = capacity.timeOffCountOn(date) > 0;
      // Blocks carry placement but zero hourly load. Their date-range overlap with time
      // off is therefore an explicit conflict signal rather than fabricated capacity.
      // Hours/Days retain their existing working-day-aware `cap.over` semantics.
      const timeOffConflict = hasTimeOff && (blocksMode ? capacity.allocationCountOn(date) > 0 : cap.over);
      if (cap.over || timeOffConflict) conflictDayCount++;
      if (partialCapacity) partialCapacityDayCount++;
      dayStates.push({
        over: cap.over,
        timeOffConflict,
        unavailable,
        partialCapacity,
        creationBlocked,
        hasTimeOff,
      });
    }
    // Starved rows draw no blocks (see CapacitySource); tracked rows share the company
    // array and reuse one side untouched when the other is empty, same as mergeTimeOff.
    const personalTimeOffBlocks = resTimeOff.filter(intersectsTimeline).map(timeOffBlockFor);
    const timeOff: TimeOffBlock[] = capacity.tracked ? personalTimeOffBlocks : NO_TIME_OFF_BLOCKS;
    // The DISPLAYED utilisation % runs over the VISIBLE window [visStart, visEnd]; the
    // `overSoon` red flag runs over the FIXED forward window [overStart, overEnd] — two
    // deliberately separate signals (see the param doc above). Utilisation ignores zero-capacity
    // days in its denominator; overSoon follows the strict per-day allocated > available rule, so
    // a time-off day or an opted-in weekend can trip it while a merely-spanned weekend still cannot
    // (weekend-aware allocated hours are zero). Starved rows answer 0 / never over.
    const utilization = capacity.utilizationOver(visDays);
    const overSoon = capacity.overOn(overDays);
    return {
      resource,
      rowHeight: rowHeightForLanes(laneCount, laneLayout),
      bars,
      dayStates,
      conflictDayCount,
      partialCapacityDayCount,
      timeOff,
      utilization,
      overSoon,
      dimmed,
    };
  };
}
