import { blockHoursPerDay } from "@capacitylens/shared/lib/schedulingDays";
import type { DateRange } from "../../lib/gestureMath";
import type { BarLayout } from "./schedulerModel";
import { m } from "@/i18n";
import {
  capacityAdvisory,
  formatCapacityAdvisory,
  capacityAllocationsForMode,
  capacityForWindow,
  timeOffApplyingTo,
} from "../../lib/capacity";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { carriesHourlyLoad, FULL_DAY_HOURS, isCapacityTracked, type ID } from "@capacitylens/shared/types/entities";
import { resourceDisplayName } from "../../lib/metadata";
import { accountWorkingDaysFor, schedulingModeFor, visibleRange } from "../../store/selectors";
import { useStore } from "../../store/useStore";
import { activeGestureData } from "./gestureLanes";

/** Builds the screen-reader status from the same visible-range capacity signal as the grid. */
export function capacityAnnouncement(resourceId: ID): string {
  const { data: storedData, ui, activeAccountId } = useStore.getState();
  const data = activeGestureData(storedData, activeAccountId);
  const resource = data.resources.find((candidate) => candidate.id === resourceId);
  if (!resource || !isCapacityTracked(resource)) return "";

  const name = resourceDisplayName(resource);
  const blocksMode = !carriesHourlyLoad(schedulingModeFor(storedData, activeAccountId));
  const allocations = capacityAllocationsForMode(
    data.allocations.filter((allocation) => allocation.resourceId === resourceId),
    blocksMode,
  );
  if (allocations.length === 0) return m.scheduler_sr_announce_clear({ name });

  let start = allocations[0]!.startDate;
  let end = allocations[0]!.endDate;
  for (const allocation of allocations) {
    if (allocation.startDate < start) start = allocation.startDate;
    if (allocation.endDate > end) end = allocation.endDate;
  }
  const visible = visibleRange(ui);
  if (start < visible.start) start = visible.start;
  if (end > visible.end) end = visible.end;
  if (start > end) return m.scheduler_sr_announce_clear({ name });

  const timeOff = timeOffApplyingTo(resourceId, data.timeOff);
  const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDaysFor(storedData, activeAccountId));
  const overDays = capacityForWindow(resource, allocations, timeOff, start, end, effectiveWeek, data.closures).filter(
    (day) => day.over,
  ).length;
  if (overDays === 0) return m.scheduler_sr_announce_clear({ name });
  return overDays === 1
    ? m.scheduler_sr_announce_over_one({ name, count: overDays })
    : m.scheduler_sr_announce_over_other({ name, count: overDays });
}

export function capacityGestureAdvisory(
  bar: BarLayout,
  effectiveResourceId: ID,
  isBlocks: boolean,
  dates: DateRange,
  reconciledHours: number,
) {
  const { data: storedData, activeAccountId } = useStore.getState();
  const data = activeGestureData(storedData, activeAccountId);
  const resource = data.resources.find((candidate) => candidate.id === effectiveResourceId);
  let advisory = "";
  if (resource && isCapacityTracked(resource)) {
    const others = capacityAllocationsForMode(
      data.allocations.filter(
        (allocation) => allocation.resourceId === effectiveResourceId && allocation.id !== bar.allocation.id,
      ),
      isBlocks,
    );
    const timeOff = timeOffApplyingTo(effectiveResourceId, data.timeOff);
    const result = capacityAdvisory(
      resource,
      {
        resourceId: effectiveResourceId,
        startDate: dates.startDate,
        endDate: dates.endDate,
        // Blocks carry placement but no hourly load — read that load from the ONE knob
        // (`blockHoursPerDay`) rather than hardcoding its current 0, exactly as the grid's
        // own `capacityAllocationsForMode` projection does.
        hoursPerDay: isBlocks ? blockHoursPerDay(FULL_DAY_HOURS) : reconciledHours,
        ignoreWeekends: bar.allocation.ignoreWeekends,
      },
      others,
      timeOff,
      effectiveWorkingWeek(resource, accountWorkingDaysFor(storedData, activeAccountId)),
      data.closures,
    );
    advisory = formatCapacityAdvisory(result, "toast");
  }
  return advisory;
}
