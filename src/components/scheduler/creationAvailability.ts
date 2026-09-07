import { weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWeekIncludes, effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isOnClosure, isOnTimeOff } from "../../lib/capacity";
import type { Closure, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";

interface ResolveCreationBlockReasonInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  accountWorkingDays: Weekday[];
  ignoreWorkingDays: boolean | undefined;
  closures: Closure[];
}

interface ResolveCalendarCreationBlockReasonInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  calendarAllowsStart: boolean;
  ignoreWorkingDays: boolean | undefined;
  closures: Closure[];
}

interface ResolveEffectiveWeekCreationBlockReasonInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  effectiveWeek: EffectiveWorkingWeek;
  closures: Closure[];
}

interface IsCreationStartBlockedForEffectiveWeekInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  effectiveWeek: EffectiveWorkingWeek;
  closures: Closure[];
}

interface IsAllocationMoveStartBlockedInput {
  resource: Resource;
  date: ISODate;
  accountWorkingDays: Weekday[];
  ignoreWorkingDays: boolean | undefined;
}

interface IsCreationStartBlockedInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  accountWorkingDays: Weekday[];
  closures: Closure[];
}

/** Recurring weekdays on which an allocation may start for this resource. Company closures also
 *  block tracked resources; externals ignore closures and use only the company working calendar.
 *  TRANSITIONAL SEAM: the ONLY place an EffectiveWorkingWeek collapses to a plain array. An empty
 *  result for "none" happens to be correct for start gating (every day blocked); #257 Phases 3-5
 *  replace this with explicit "none" branches where downstream behavior must differ. */
export function resolveEffectiveWorkingDays(resource: Resource, accountWorkingDays: Weekday[]): Weekday[] {
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
const NO_CLOSURES: Closure[] = [];

/** THE start-of-gesture gate, shared by every surface that asks "may a bar start on this
 *  resource-day?" (the model's per-day `creationBlocked`, the grid's draw commit, and the
 *  drag/keyboard move paths). Returns the REASON so a caller that must tell the two apart can,
 *  without re-deriving either rule. `timeOff` need not be pre-filtered by resource. */
export function resolveCreationBlockReason({
  resource,
  date,
  timeOff,
  accountWorkingDays,
  ignoreWorkingDays,
  closures,
}: ResolveCreationBlockReasonInput): CreationBlockReason | null {
  return resolveCalendarCreationBlockReason({
    resource,
    date,
    timeOff,
    calendarAllowsStart: resolveEffectiveWorkingDays(resource, accountWorkingDays).includes(weekdayOf(date)),
    ignoreWorkingDays,
    closures,
  });
}

function resolveCalendarCreationBlockReason({
  resource,
  date,
  timeOff,
  calendarAllowsStart,
  ignoreWorkingDays,
  closures,
}: ResolveCalendarCreationBlockReasonInput): CreationBlockReason | null {
  if (!ignoreWorkingDays && !calendarAllowsStart) {
    return "non-working";
  }
  return (!isExternalResource(resource) && isOnTimeOff(resource.id, date, timeOff)) ||
    isOnClosure(resource, date, closures)
    ? "time-off"
    : null;
}

/** The resolved-week variant of `resolveCreationBlockReason`, for callers (the scheduler rows, the modal's
 * typed-date gate) that already hold the effective week. Same rules, same reasons: the creation
 * gate never honors the allocation-level override — there is no ignored-creation escape hatch. */
export function resolveEffectiveWeekCreationBlockReason({
  resource,
  date,
  timeOff,
  effectiveWeek,
  closures,
}: ResolveEffectiveWeekCreationBlockReasonInput): CreationBlockReason | null {
  const calendarAllowsStart = effectiveWeekIncludes(effectiveWeek, weekdayOf(date));
  return resolveCalendarCreationBlockReason({
    resource,
    date,
    timeOff,
    calendarAllowsStart,
    ignoreWorkingDays: false,
    closures,
  });
}

/** The per-row scheduler variant: its caller has already resolved the effective week once and
 * reuses it for capacity and every day-state instead of re-intersecting calendars per date. */
export function isCreationStartBlockedForEffectiveWeek({
  resource,
  date,
  timeOff,
  effectiveWeek,
  closures,
}: IsCreationStartBlockedForEffectiveWeekInput): boolean {
  return resolveEffectiveWeekCreationBlockReason({ resource, date, timeOff, effectiveWeek, closures }) !== null;
}

/** Whether recurring company/personal calendars reject an EXISTING allocation's proposed start.
 *  The allocation-level override intentionally bypasses both; time off is a separate conflict. */
export function isAllocationMoveStartBlocked({
  resource,
  date,
  accountWorkingDays,
  ignoreWorkingDays,
}: IsAllocationMoveStartBlockedInput): boolean {
  return (
    resolveCreationBlockReason({
      resource,
      date,
      timeOff: NO_TIME_OFF,
      accountWorkingDays,
      ignoreWorkingDays,
      closures: NO_CLOSURES,
    }) !== null
  );
}

/** Whether a schedule gesture may begin on this date. Spans may cross later blocked dates. */
export function isCreationStartBlocked({
  resource,
  date,
  timeOff,
  accountWorkingDays,
  closures,
}: IsCreationStartBlockedInput): boolean {
  return (
    resolveCreationBlockReason({ resource, date, timeOff, accountWorkingDays, ignoreWorkingDays: false, closures }) !==
    null
  );
}
