import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { daysInclusive, eachDayISO, todayISO } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek, lacksEffectiveWorkingDays } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { spanDays } from "@capacitylens/shared/lib/schedulingDays";
import type { Resource } from "@capacitylens/shared/types/entities";
import { FULL_DAY_HOURS } from "@capacitylens/shared/types/entities";
import { scheduledHoursOnDay } from "../../lib/capacity";

import { projectSelectionForActivity, usesWorkingSpanFor } from "./allocationModalSelection";
import type { AllocationModalSnapshot } from "./allocationModalSnapshot";
export function allocationModalSeed({
  editing,
  create,
  data,
  mode,
  resourceById,
  accountWorkingDays,
  calendarTimeZone,
}: Pick<AllocationModalSnapshot, "editing" | "create" | "data" | "mode"> & {
  resourceById: Map<string, Resource>;
  accountWorkingDays: ReturnType<typeof normalizeAccountWorkingDays>;
  calendarTimeZone: string;
}) {
  const initialActivity = editing ? data.activities.find((act) => act.id === editing.activityId) : undefined;
  const initialResourceId = editing?.resourceId ?? create?.resourceId ?? "";
  const initialResource = resourceById.get(initialResourceId);
  const initialEffectiveWeek = initialResource ? effectiveWorkingWeek(initialResource, accountWorkingDays) : null;
  const initialPlaceholderProjectId = initialResource?.kind === "placeholder" ? initialResource.projectId : undefined;
  const initialLocked = editing
    ? (editing.projectId ??
      (initialActivity
        ? projectSelectionForActivity(initialActivity)
        : // A dangling activity cannot identify the scope; a placeholder's binding remains authoritative.
          initialPlaceholderProjectId))
    : initialPlaceholderProjectId;
  const initialStart = editing?.startDate ?? create?.startDate ?? todayISO(calendarTimeZone);
  const initialScheduledHours =
    initialResource && initialEffectiveWeek
      ? scheduledHoursOnDay(initialResource, initialStart, initialEffectiveWeek)
      : FULL_DAY_HOURS;

  // Days-mode inputs (used only when isDays). For an EXISTING allocation we invert
  // hours/dates against the assignee/company effective week; for a NEW one we honour the span
  // the user drew on the lane (start..end) at full-time load, mirroring how hourly
  // create defaults hours to a full working day across the same range.
  const seedEnd = editing?.endDate ?? create?.endDate;
  const initialIgnoreWeekends = editing?.ignoreWeekends ?? false;
  const initialUsesWorkingSpan = usesWorkingSpanFor(initialResource, mode);
  const initialHasNoEffectiveDays =
    initialUsesWorkingSpan && lacksEffectiveWorkingDays(initialEffectiveWeek, initialIgnoreWeekends);
  const initialDaysOver = !seedEnd
    ? 1
    : initialHasNoEffectiveDays
      ? // Neutral seed: keeps `none` out of spanDays without pretending the typed range is a
        // working-day span. New placement is rejected by rejectNewPlacementCalendarConflicts.
        1
      : initialUsesWorkingSpan
        ? Math.max(
            1,
            spanDays(initialStart, seedEnd, {
              workingDays: initialEffectiveWeek?.kind === "days" ? initialEffectiveWeek.days : undefined,
              ignoreWeekends: initialIgnoreWeekends,
            }),
          )
        : Math.max(1, daysInclusive(initialStart, seedEnd));
  const initialCapacityHours =
    initialResource && initialEffectiveWeek
      ? eachDayISO(initialStart, seedEnd ?? initialStart).reduce(
          (sum, day) => sum + scheduledHoursOnDay(initialResource, day, initialEffectiveWeek),
          0,
        )
      : initialDaysOver * FULL_DAY_HOURS;
  return {
    editing,
    create,
    initialResourceId,
    initialResource,
    initialLocked,
    initialStart,
    initialScheduledHours,
    initialDaysOver,
    initialCapacityHours,
  };
}
export type AllocationModalSeed = ReturnType<typeof allocationModalSeed>;
