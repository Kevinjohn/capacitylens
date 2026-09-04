import { daysInclusive } from "@capacitylens/shared/lib/dateMath";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import {
  capacityAdvisory,
  capacityAllocationsForMode,
  formatCapacityAdvisory,
  timeOffApplyingTo,
} from "../../lib/capacity";
import { repeatingAllocationAdvisory } from "../../lib/repeatingAllocations";

import type { AllocationModalSnapshot } from "./allocationModalSnapshot";
import { projectRepeat } from "./allocationRepeatProjection";

export function advisoryFor({
  attributedProjectId,
  create,
  editId,
  effEndDate,
  effHoursPerDay,
  ignoreWeekends,
  isBlocks,
  isExternal,
  repeat,
  repeatProjection,
  resourceId,
  selectedResource,
  selectedEffectiveWeek,
  startDate,
  data,
}: Pick<
  AllocationModalSnapshot,
  | "attributedProjectId"
  | "create"
  | "editId"
  | "effEndDate"
  | "effHoursPerDay"
  | "ignoreWeekends"
  | "isBlocks"
  | "isExternal"
  | "repeat"
  | "resourceId"
  | "selectedResource"
  | "selectedEffectiveWeek"
  | "startDate"
> & {
  data: Pick<AllocationModalSnapshot["data"], "allocations" | "closures" | "timeOff">;
  repeatProjection: ReturnType<typeof projectRepeat>;
}) {
  // External parties have no capacity — never show an over-capacity / time-off advisory.
  if (isExternal) return null;
  // A malformed/reversed span and a range beyond the form's finite work bound get no advisory.
  // This check is O(1) and runs before capacityAdvisory can materialise one ISO string per day.
  const span = startDate && effEndDate ? daysInclusive(startDate, effEndDate) : 0;
  if (!selectedResource || !selectedEffectiveWeek || !startDate || !effEndDate || span < 1 || span > MAX_SPAN_DAYS) {
    return null;
  }
  // Project the existing load through the account's scheduling mode BEFORE counting it: in blocks
  // mode a bar carries placement but no hourly load, so an account that switched to blocks with
  // legacy hourly allocations must not be advised "over capacity" here while the grid's markers
  // (schedulerModel) and the drag-commit toast (useAllocationGesture) — both of which project the
  // same way — show nothing. Every capacity surface reads the same projected load.
  const others = capacityAllocationsForMode(
    data.allocations.filter((a) => a.resourceId === resourceId && a.id !== editId),
    isBlocks,
  );
  const resourceTimeOff = timeOffApplyingTo(resourceId, data.timeOff);
  if (create && repeat !== "none") {
    if (!repeatProjection) return null;
    // The repeat variant counts whole OCCURRENCES rather than days; the two tallies otherwise read
    // and render identically, so they share the one advisory sentence builder.
    const { overCapacityAllocations, timeOffAllocations, nonEffectiveStartAllocations } = repeatingAllocationAdvisory(
      selectedResource,
      others,
      resourceTimeOff,
      repeatProjection.drafts,
      selectedEffectiveWeek,
      data.closures,
    );
    return (
      formatCapacityAdvisory(
        {
          overDays: overCapacityAllocations,
          timeOffDays: timeOffAllocations,
          nonEffectiveStartAllocations,
        },
        "repeat",
      ) || null
    );
  }
  return (
    formatCapacityAdvisory(
      capacityAdvisory(
        selectedResource,
        {
          resourceId,
          startDate,
          endDate: effEndDate,
          hoursPerDay: effHoursPerDay,
          ignoreWeekends,
          ...(attributedProjectId ? { projectId: attributedProjectId } : {}),
        },
        others,
        resourceTimeOff,
        selectedEffectiveWeek,
        data.closures,
      ),
      "form",
    ) || null
  );
}
