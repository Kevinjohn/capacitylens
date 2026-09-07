import { blockHoursPerDay } from "@capacitylens/shared/lib/schedulingDays";
import type { DateRange } from "../../lib/gestureMath";
import type { BarLayout } from "./schedulerModel";
import { m } from "@/i18n";
import {
  buildCapacityAdvisory,
  formatCapacityAdvisory,
  applyCapacityMode,
  buildCapacityWindow,
  listTimeOffApplyingTo,
} from "../../lib/capacity";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { carriesHourlyLoad, FULL_DAY_HOURS, isCapacityTracked, type ID } from "@capacitylens/shared/types/entities";
import { resolveResourceDisplayName } from "../../lib/metadata";
import { listAccountWorkingDays, resolveSchedulingMode, buildVisibleRange } from "../../store/selectors";
import { useStore } from "../../store/useStore";
import { buildActiveGestureData } from "./gestureLanes";

interface ReadCapacityGestureAdvisoryInput {
  bar: BarLayout;
  effectiveResourceId: ID;
  isBlocks: boolean;
  dates: DateRange;
  reconciledHours: number;
}

/** Builds the screen-reader status from the same visible-range capacity signal as the grid. */
export function readCapacityAnnouncement(resourceId: ID): string {
  const { data: storedData, ui, activeAccountId } = useStore.getState();
  const data = buildActiveGestureData(storedData, activeAccountId);
  const resource = data.resources.find((candidate) => candidate.id === resourceId);
  if (!resource || !isCapacityTracked(resource)) return "";

  const name = resolveResourceDisplayName(resource);
  const blocksMode = !carriesHourlyLoad(resolveSchedulingMode(storedData, activeAccountId));
  const allocations = applyCapacityMode({
    allocations: data.allocations.filter((allocation) => allocation.resourceId === resourceId),
    blocksMode: blocksMode,
  });
  if (allocations.length === 0) return m.scheduler_sr_announce_clear({ name });

  let start = allocations[0].startDate;
  let end = allocations[0].endDate;
  for (const allocation of allocations) {
    if (allocation.startDate < start) start = allocation.startDate;
    if (allocation.endDate > end) end = allocation.endDate;
  }
  const visible = buildVisibleRange(ui);
  if (start < visible.start) start = visible.start;
  if (end > visible.end) end = visible.end;
  if (start > end) return m.scheduler_sr_announce_clear({ name });

  const timeOff = listTimeOffApplyingTo(resourceId, data.timeOff);
  const effectiveWeek = effectiveWorkingWeek(resource, listAccountWorkingDays(storedData, activeAccountId));
  const overDays = buildCapacityWindow({
    resource: resource,
    allocations: allocations,
    timeOff: timeOff,
    start: start,
    end: end,
    effectiveWeek: effectiveWeek,
    closures: data.closures,
  }).filter((day) => day.over).length;
  if (overDays === 0) return m.scheduler_sr_announce_clear({ name });
  return overDays === 1
    ? m.scheduler_sr_announce_over_one({ name, count: overDays })
    : m.scheduler_sr_announce_over_other({ name, count: overDays });
}

export function readCapacityGestureAdvisory({
  bar,
  effectiveResourceId,
  isBlocks,
  dates,
  reconciledHours,
}: ReadCapacityGestureAdvisoryInput) {
  const { data: storedData, activeAccountId } = useStore.getState();
  const data = buildActiveGestureData(storedData, activeAccountId);
  const resource = data.resources.find((candidate) => candidate.id === effectiveResourceId);
  let advisory = "";
  if (resource && isCapacityTracked(resource)) {
    const others = applyCapacityMode({
      allocations: data.allocations.filter(
        (allocation) => allocation.resourceId === effectiveResourceId && allocation.id !== bar.allocation.id,
      ),
      blocksMode: isBlocks,
    });
    const timeOff = listTimeOffApplyingTo(effectiveResourceId, data.timeOff);
    const result = buildCapacityAdvisory({
      resource: resource,
      proposal: {
        resourceId: effectiveResourceId,
        startDate: dates.startDate,
        endDate: dates.endDate,
        // Blocks carry placement but no hourly load — read that load from the ONE knob
        // (`blockHoursPerDay`) rather than hardcoding its current 0, exactly as the grid's
        // own `applyCapacityMode` projection does.
        hoursPerDay: isBlocks ? blockHoursPerDay(FULL_DAY_HOURS) : reconciledHours,
        ignoreWeekends: bar.allocation.ignoreWeekends,
      },
      otherAllocations: others,
      timeOff: timeOff,
      effectiveWeek: effectiveWorkingWeek(resource, listAccountWorkingDays(storedData, activeAccountId)),
      closures: data.closures,
    });
    advisory = formatCapacityAdvisory(result, "toast");
  }
  return advisory;
}
