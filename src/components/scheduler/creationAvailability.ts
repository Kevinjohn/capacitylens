import { weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWeekIncludes, effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isOnCompanyTimeOff, isOnTimeOff } from "../../lib/capacity";
import type { ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";

/** Recurring weekdays on which an allocation may start for this resource. Company closure wins;
 *  externals have no personal capacity pattern, so only the company calendar applies to them.
 *  TRANSITIONAL SEAM: the ONLY place an EffectiveWorkingWeek collapses to a plain array. An empty
 *  result for "none" happens to be correct for start gating (every day blocked); #257 Phases 3-5
 *  replace this with explicit "none" branches where downstream behavior must differ. */
export function effectiveWorkingDays(resource: Resource, accountWorkingDays: Weekday[]): Weekday[] {
  const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
  return effectiveWeek.kind === "days" ? effectiveWeek.days : [];
}

/** Why a schedule gesture may not begin on a date: the recurring company/personal calendars reject
 *  it, or the resource is on time off. Distinct because the two are separately overridable — an
 *  allocation-level `ignoreWorkingDays` bypasses the calendars only. */
export type CreationBlockReason = "non-working" | "time-off";

/** No time off to consider — a move gate asks the calendars only, and a shared empty array keeps
 *  that from allocating on a per-pointermove path. */
const NO_TIME_OFF: TimeOff[] = [];

/** THE start-of-gesture gate, shared by every surface that asks "may a bar start on this
 *  resource-day?" (the model's per-day `creationBlocked`, the grid's draw commit, and the
 *  drag/keyboard move paths). Returns the REASON so a caller that must tell the two apart can,
 *  without re-deriving either rule. `timeOff` need not be pre-filtered by resource. */
export function creationBlockedAt(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  accountWorkingDays: Weekday[],
  ignoreWorkingDays?: boolean,
): CreationBlockReason | null {
  return creationBlockedForCalendar(
    resource,
    date,
    timeOff,
    effectiveWorkingDays(resource, accountWorkingDays).includes(weekdayOf(date)),
    ignoreWorkingDays,
  );
}

function creationBlockedForCalendar(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  calendarAllowsStart: boolean,
  ignoreWorkingDays?: boolean,
): CreationBlockReason | null {
  if (!ignoreWorkingDays && !calendarAllowsStart) {
    return "non-working";
  }
  // Externals stay exempt from personal time off — even a stray record targeting their id (the
  // domain layer forbids writing one, but corrupt data must not gate the lane; the test suite
  // pins this). A company-wide closure gates them anyway: the agency is shut.
  if (isExternalResource(resource)) {
    return isOnCompanyTimeOff(date, timeOff) ? "time-off" : null;
  }
  return isOnTimeOff(resource.id, date, timeOff) ? "time-off" : null;
}

/** The resolved-week variant of `creationBlockedAt`, for callers (the scheduler rows, the modal's
 * typed-date gate) that already hold the effective week. Same rules, same reasons: the creation
 * gate never honors the allocation-level override — there is no ignored-creation escape hatch. */
export function creationBlockedForEffectiveWeek(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
): CreationBlockReason | null {
  const calendarAllowsStart = effectiveWeekIncludes(effectiveWeek, weekdayOf(date));
  return creationBlockedForCalendar(resource, date, timeOff, calendarAllowsStart, false);
}

/** The per-row scheduler variant: its caller has already resolved the effective week once and
 * reuses it for capacity and every day-state instead of re-intersecting calendars per date. */
export function isCreationStartBlockedForEffectiveWeek(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
): boolean {
  return creationBlockedForEffectiveWeek(resource, date, timeOff, effectiveWeek) !== null;
}

/** Whether recurring company/personal calendars reject an EXISTING allocation's proposed start.
 *  The allocation-level override intentionally bypasses both; time off is a separate conflict. */
export function isAllocationMoveStartBlocked(
  resource: Resource,
  date: ISODate,
  accountWorkingDays: Weekday[],
  ignoreWorkingDays: boolean | undefined,
): boolean {
  return creationBlockedAt(resource, date, NO_TIME_OFF, accountWorkingDays, ignoreWorkingDays) !== null;
}

/** Whether a schedule gesture may begin on this date. Spans may cross later blocked dates. */
export function isCreationStartBlocked(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  accountWorkingDays: Weekday[],
): boolean {
  return creationBlockedAt(resource, date, timeOff, accountWorkingDays, false) !== null;
}
