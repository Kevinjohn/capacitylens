import { daysInclusive } from "@capacitylens/shared/lib/dateMath";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import {
  buildCapacityAdvisory,
  applyCapacityMode,
  formatCapacityAdvisory,
  listTimeOffApplyingTo,
} from "../../lib/capacity";
import { buildRepeatingAllocationAdvisory } from "../../lib/repeatingAllocations";

import type { AllocationModalSnapshot } from "./allocationModalSnapshot";
import { buildRepeatProjection } from "./buildRepeatProjection";

type AdvisoryInput = Pick<
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
  repeatProjection: ReturnType<typeof buildRepeatProjection>;
};

function canBuildAdvisory(input: AdvisoryInput) {
  const { effEndDate: endDate, isExternal, selectedResource, selectedEffectiveWeek, startDate } = input;
  if (isExternal || !selectedResource || selectedEffectiveWeek === undefined || !startDate || !endDate) return false;
  const span = daysInclusive(startDate, endDate);
  return span >= 1 && span <= MAX_SPAN_DAYS;
}

function buildRepeatAdvisory(input: AdvisoryInput, existingLoad: AdvisoryInput["data"]["allocations"]) {
  const { data, repeatProjection, resourceId, selectedEffectiveWeek, selectedResource } = input;
  if (!repeatProjection || !selectedResource || selectedEffectiveWeek === undefined) return null;
  const resourceTimeOff = listTimeOffApplyingTo(resourceId, data.timeOff);
  const { overCapacityAllocations, timeOffAllocations, nonEffectiveStartAllocations } =
    buildRepeatingAllocationAdvisory({
      resource: selectedResource,
      existingLoad,
      timeOff: resourceTimeOff,
      proposedDrafts: repeatProjection.drafts,
      effectiveWeek: selectedEffectiveWeek,
      closures: data.closures,
    });
  return (
    formatCapacityAdvisory(
      { overDays: overCapacityAllocations, timeOffDays: timeOffAllocations, nonEffectiveStartAllocations },
      "repeat",
    ) || null
  );
}

function buildSingleAdvisory(input: AdvisoryInput, otherAllocations: AdvisoryInput["data"]["allocations"]) {
  const {
    attributedProjectId,
    data,
    effEndDate: endDate,
    effHoursPerDay: hoursPerDay,
    ignoreWeekends,
    resourceId,
    selectedEffectiveWeek,
    selectedResource,
    startDate,
  } = input;
  if (!selectedResource || selectedEffectiveWeek === undefined) return null;
  return (
    formatCapacityAdvisory(
      buildCapacityAdvisory({
        resource: selectedResource,
        proposal: {
          resourceId,
          startDate,
          endDate,
          hoursPerDay,
          ignoreWeekends,
          ...(attributedProjectId ? { projectId: attributedProjectId } : {}),
        },
        otherAllocations,
        timeOff: listTimeOffApplyingTo(resourceId, data.timeOff),
        effectiveWeek: selectedEffectiveWeek,
        closures: data.closures,
      }),
      "form",
    ) || null
  );
}

export function buildAllocationAdvisory(input: AdvisoryInput) {
  const { create, data, editId, isBlocks, repeat, resourceId } = input;
  // External parties have no capacity — never show an over-capacity / time-off advisory.
  if (!canBuildAdvisory(input)) return null;
  // Project the existing load through the account's scheduling mode BEFORE counting it: in blocks
  // mode a bar carries placement but no hourly load, so an account that switched to blocks with
  // legacy hourly allocations must not be advised "over capacity" here while the grid's markers
  // (schedulerModel) and the drag-commit toast (useAllocationGesture) — both of which project the
  // same way — show nothing. Every capacity surface reads the same projected load.
  const others = applyCapacityMode({
    allocations: data.allocations.filter(
      (allocation) => allocation.resourceId === resourceId && allocation.id !== editId,
    ),
    blocksMode: isBlocks,
  });
  if (create && repeat !== "none") {
    // The repeat variant counts whole OCCURRENCES rather than days; the two tallies otherwise read
    // and render identically, so they share the one advisory sentence builder.
    return buildRepeatAdvisory(input, others);
  }
  return buildSingleAdvisory(input, others);
}
