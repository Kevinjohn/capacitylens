import { daysInclusive } from "@capacitylens/shared/lib/dateMath";
import { isValidISODate, validateAllocationAssignment } from "@capacitylens/shared/lib/integrity";
import { generateRepeatingStartDates } from "@capacitylens/shared/lib/repeatingDates";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import { MAX_HOURS_PER_DAY } from "@capacitylens/shared/types/entities";
import { projectAllocationDates, repeatPatternForSelection } from "../../lib/repeatingAllocations";

import type { AllocationModalSnapshot } from "./allocationModalSnapshot";

export function projectRepeat({
  activityId,
  create,
  attributedProjectId,
  daysOfWork,
  daysOver,
  effEndDate,
  effHoursPerDay,
  ignoreWeekends,
  isBlocks,
  isDays,
  isExternal,
  mode,
  note,
  repeat,
  repeatUntil,
  repeatUntilMaximum,
  repeatUntilMinimum,
  resourceId,
  selectedActivity,
  selectedEffectiveProjectId,
  selectedResource,
  selectedEffectiveWeek,
  spanFitsDateDomain,
  startDate,
  status,
  validDaysOver,
}: Pick<
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
>) {
  if (!create || repeat === "none" || !selectedResource || !selectedEffectiveWeek || !resourceId || !activityId) {
    return null;
  }
  if (!isValidISODate(startDate) || !isValidISODate(effEndDate) || effEndDate < startDate) return null;
  if (
    !isValidISODate(repeatUntil) ||
    repeatUntil < repeatUntilMinimum ||
    !repeatUntilMaximum ||
    repeatUntil > repeatUntilMaximum
  )
    return null;
  if (daysInclusive(startDate, effEndDate) > MAX_SPAN_DAYS) return null;
  if ((isDays || isBlocks) && (!validDaysOver || !spanFitsDateDomain)) return null;
  if (isDays && !(daysOfWork > 0)) return null;
  if (
    !isExternal &&
    !isBlocks &&
    !(Number.isFinite(effHoursPerDay) && effHoursPerDay > 0 && effHoursPerDay <= MAX_HOURS_PER_DAY)
  )
    return null;
  if (!selectedActivity || !validateAllocationAssignment(selectedResource, selectedEffectiveProjectId).ok) return null;
  try {
    const { startDates } = generateRepeatingStartDates(startDate, repeatUntil, repeatPatternForSelection(repeat));
    const drafts = projectAllocationDates(
      {
        resourceId,
        activityId,
        startDate,
        endDate: effEndDate,
        hoursPerDay: effHoursPerDay,
        status,
        note: note || undefined,
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
