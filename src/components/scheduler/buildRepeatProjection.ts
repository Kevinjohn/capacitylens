import { daysInclusive } from "@capacitylens/shared/lib/dateMath";
import { isValidISODate, validateAllocationAssignment } from "@capacitylens/shared/lib/integrity";
import { generateRepeatingStartDates } from "@capacitylens/shared/lib/repeatingDates";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import { MAX_HOURS_PER_DAY } from "@capacitylens/shared/types/entities";
import { buildRepeatedAllocationDrafts, resolveRepeatPattern } from "../../lib/repeatingAllocations";

import type { AllocationModalSnapshot } from "./allocationModalSnapshot";

type ProjectionInput = Pick<
  AllocationModalSnapshot,
  | "activityId"
  | "create"
  | "attributedProjectId"
  | "daysOfWork"
  | "daysOver"
  | "effEndDate"
  | "effHoursPerDay"
  | "ignoreWeekends"
  | "isBlocks"
  | "isDays"
  | "isExternal"
  | "mode"
  | "note"
  | "repeat"
  | "repeatUntil"
  | "repeatUntilMaximum"
  | "repeatUntilMinimum"
  | "resourceId"
  | "selectedActivity"
  | "selectedEffectiveProjectId"
  | "selectedResource"
  | "selectedEffectiveWeek"
  | "spanFitsDateDomain"
  | "startDate"
  | "status"
  | "validDaysOver"
>;

function resolveProjectionContext(input: ProjectionInput) {
  const { activityId, create, repeat, resourceId, selectedEffectiveWeek, selectedResource } = input;
  if (!create || repeat === "none" || !selectedResource || selectedEffectiveWeek === undefined) return null;
  if (!resourceId || !activityId) return null;
  return { activityId, resourceId, selectedEffectiveWeek, selectedResource };
}

function hasValidProjectionDates(input: ProjectionInput) {
  const {
    effEndDate: endDate,
    repeatUntil,
    repeatUntilMaximum,
    repeatUntilMinimum,
    spanFitsDateDomain,
    startDate,
    validDaysOver,
    isBlocks,
    isDays,
  } = input;
  if (!isValidISODate(startDate) || !isValidISODate(endDate) || endDate < startDate) return false;
  if (!isValidISODate(repeatUntil) || repeatUntil < repeatUntilMinimum) return false;
  if (!repeatUntilMaximum || repeatUntil > repeatUntilMaximum) return false;
  if (daysInclusive(startDate, endDate) > MAX_SPAN_DAYS) return false;
  return !(isDays || isBlocks) || (validDaysOver && spanFitsDateDomain);
}

function hasValidProjectionLoad(input: ProjectionInput) {
  const { daysOfWork, effHoursPerDay: hoursPerDay, isBlocks, isDays, isExternal } = input;
  if (isDays && !(daysOfWork > 0)) return false;
  if (isExternal || isBlocks) return true;
  return Number.isFinite(hoursPerDay) && hoursPerDay > 0 && hoursPerDay <= MAX_HOURS_PER_DAY;
}

function buildProjection(input: ProjectionInput, context: NonNullable<ReturnType<typeof resolveProjectionContext>>) {
  const {
    attributedProjectId,
    daysOver,
    effEndDate: endDate,
    effHoursPerDay: hoursPerDay,
    ignoreWeekends,
    isExternal,
    mode,
    note,
    repeat,
    repeatUntil,
    startDate,
    status,
  } = input;
  const { activityId, resourceId, selectedEffectiveWeek, selectedResource } = context;
  try {
    const { startDates } = generateRepeatingStartDates(startDate, repeatUntil, resolveRepeatPattern(repeat));
    const drafts = buildRepeatedAllocationDrafts(
      {
        resourceId,
        activityId,
        startDate,
        endDate,
        hoursPerDay,
        status,
        ...(note ? { note } : {}),
        ignoreWeekends: isExternal ? true : ignoreWeekends,
        ...(attributedProjectId ? { projectId: attributedProjectId } : {}),
      },
      startDates,
      { schedulingMode: mode, daysOver, resource: selectedResource, effectiveWeek: selectedEffectiveWeek },
    );
    return { drafts, startDates };
  } catch (error) {
    // A near-boundary date can be valid input while a projected occurrence cannot fit. Save owns
    // the localized error surface; invariant/programming errors remain loud instead of disappearing.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function buildRepeatProjection(input: ProjectionInput) {
  const { selectedActivity, selectedEffectiveProjectId } = input;
  const context = resolveProjectionContext(input);
  if (!context || !hasValidProjectionDates(input) || !hasValidProjectionLoad(input)) return null;
  if (!selectedActivity || !validateAllocationAssignment(context.selectedResource, selectedEffectiveProjectId).ok)
    return null;
  return buildProjection(input, context);
}
