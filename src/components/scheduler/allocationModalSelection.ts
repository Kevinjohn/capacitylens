import { daysInclusive, MAX_ISO_DATE } from "@capacitylens/shared/lib/dateMath";
import { lacksEffectiveWorkingDays } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { allocationAttributionAllowed } from "@capacitylens/shared/lib/integrity";
import {
  blockHoursPerDay,
  endDateForSpan,
  hoursPerDayFor,
  MAX_SPAN_DAYS,
  maxSpanDaysForStart,
} from "@capacitylens/shared/lib/schedulingDays";
import type { Activity, Resource, SchedulingMode } from "@capacitylens/shared/types/entities";
import { FULL_DAY_HOURS, isExternalResource } from "@capacitylens/shared/types/entities";

import type { EffectiveAllocationInput } from "./allocationModalTypes";
/** Snap a seeded days-of-work value to 6 decimals: enough to erase float round-trip
 *  noise (e.g. 8 × 3/7 × 7/8 = 2.9999…) WITHOUT distorting a legitimate fraction
 *  (½ → 0.5, ⅛-day → 1.875). Keeping the seed exact means re-deriving hours on a
 *  no-op save returns the original value rather than drifting it. */
export const roundDays = (dayCount: number) => Math.round(dayCount * 1e6) / 1e6;
export const INTERNAL_PROJECT_SELECTION = "__allocation_internal__";
export const ANY_PROJECT_SELECTION = "__allocation_any_project__";
export function resolveProjectSelection(activity: Activity | undefined): string {
  if (allocationAttributionAllowed(activity?.kind)) return ANY_PROJECT_SELECTION;
  if (activity?.kind === "project" && activity.projectId) return activity.projectId;
  return INTERNAL_PROJECT_SELECTION;
}

export function resolveAttributedProject(activity: Activity | undefined, selection: string): string | undefined {
  if (
    !allocationAttributionAllowed(activity?.kind) ||
    selection === INTERNAL_PROJECT_SELECTION ||
    selection === ANY_PROJECT_SELECTION
  ) {
    return undefined;
  }
  return selection;
}

export function isActivityInProjectSelection(
  activity: Pick<Activity, "kind" | "projectId">,
  selection: string,
): boolean {
  if (selection === INTERNAL_PROJECT_SELECTION) return activity.kind === "internal";
  if (selection === ANY_PROJECT_SELECTION) return activity.kind === "repeatable";
  return activity.kind === "repeatable" || (activity.kind === "project" && activity.projectId === selection);
}

export function buildActivityScope(selection: string): { kind: Activity["kind"]; projectId?: string } {
  if (selection === INTERNAL_PROJECT_SELECTION) return { kind: "internal" };
  if (selection === ANY_PROJECT_SELECTION) return { kind: "repeatable" };
  return { kind: "project", projectId: selection };
}

/** Days/Blocks derive their span from the working week; hourly and external spans stay literal. */
export function hasWorkingSpan(resource: Resource | undefined, mode: SchedulingMode): boolean {
  return !!resource && !isExternalResource(resource) && (mode === "blocks" || mode === "days");
}

function buildLiteralAllocationValues(input: EffectiveAllocationInput, external: boolean, validDaysOver: boolean) {
  return {
    external,
    validDaysOver,
    spanFitsDateDomain: true,
    maximumDaysOver: MAX_SPAN_DAYS,
    spanLimitedByDateDomain: !!input.startDate && daysInclusive(input.startDate, MAX_ISO_DATE) < MAX_SPAN_DAYS,
    endDate: input.endDate,
    hoursPerDay: external ? 0 : input.hoursPerDay,
  };
}

function buildUnavailableWeekValues(input: EffectiveAllocationInput, external: boolean, validDaysOver: boolean) {
  return {
    external,
    validDaysOver,
    spanFitsDateDomain: validDaysOver,
    maximumDaysOver: MAX_SPAN_DAYS,
    spanLimitedByDateDomain: false,
    endDate: input.endDate,
    hoursPerDay:
      input.mode === "blocks"
        ? blockHoursPerDay(FULL_DAY_HOURS)
        : hoursPerDayFor(input.daysOfWork, input.daysOver, FULL_DAY_HOURS),
  };
}

function buildWorkingWeekValues(input: EffectiveAllocationInput, external: boolean, validDaysOver: boolean) {
  const { effectiveWeek, startDate, endDate, mode, daysOver, daysOfWork, ignoreWeekends } = input;
  const spanOptions = {
    ...(effectiveWeek?.kind === "days" ? { workingDays: effectiveWeek.days } : {}),
    ignoreWeekends,
  };
  const maximumDaysOver = startDate ? maxSpanDaysForStart(startDate, spanOptions) : MAX_SPAN_DAYS;
  const spanFitsDateDomain = !!startDate && validDaysOver && daysOver <= maximumDaysOver;
  const spanEnd = startDate
    ? endDateForSpan(startDate, validDaysOver && spanFitsDateDomain ? daysOver : 1, spanOptions)
    : endDate;
  const effective =
    mode === "blocks"
      ? { endDate: spanEnd, hoursPerDay: blockHoursPerDay(FULL_DAY_HOURS) }
      : { endDate: spanEnd, hoursPerDay: hoursPerDayFor(daysOfWork, daysOver, FULL_DAY_HOURS) };
  return {
    external,
    validDaysOver,
    spanFitsDateDomain,
    maximumDaysOver,
    spanLimitedByDateDomain: !!startDate && daysInclusive(startDate, MAX_ISO_DATE) < MAX_SPAN_DAYS,
    ...effective,
  };
}

export function buildEffectiveAllocationValues({
  resource,
  effectiveWeek,
  mode,
  startDate,
  endDate,
  hoursPerDay,
  daysOver,
  daysOfWork,
  ignoreWeekends,
}: EffectiveAllocationInput) {
  const external = !!resource && isExternalResource(resource);
  const validDaysOver = Number.isSafeInteger(daysOver) && daysOver >= 1 && daysOver <= MAX_SPAN_DAYS;
  const usesWorkingSpan = hasWorkingSpan(resource, mode);
  if (!usesWorkingSpan) {
    return buildLiteralAllocationValues(
      { resource, effectiveWeek, mode, startDate, endDate, hoursPerDay, daysOver, daysOfWork, ignoreWeekends },
      external,
      validDaysOver,
    );
  }

  if (lacksEffectiveWorkingDays(effectiveWeek, ignoreWeekends)) {
    // Working-span math is impossible with no effective days, so the typed range is literal and
    // "Days over" is frozen at its seed (its field is disabled below). Every seed derives
    // daysOfWork and daysOver from the same span, so this recomputation is the identity on the
    // stored volume — the field freeze is what stops a manual change from silently diluting it.
    return buildUnavailableWeekValues(
      { resource, effectiveWeek, mode, startDate, endDate, hoursPerDay, daysOver, daysOfWork, ignoreWeekends },
      external,
      validDaysOver,
    );
  }

  return buildWorkingWeekValues(
    { resource, effectiveWeek, mode, startDate, endDate, hoursPerDay, daysOver, daysOfWork, ignoreWeekends },
    external,
    validDaysOver,
  );
}
