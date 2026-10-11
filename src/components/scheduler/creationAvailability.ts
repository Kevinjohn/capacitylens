import { weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWeekIncludes, effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isOnClosure, isOnTimeOff } from "@/lib/capacity";
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
 * block tracked resources; externals ignore closures and use only the company working calendar.
 * A week with no effective days returns an empty array, so every start date is blocked. */
export function resolveEffectiveWorkingDays(resource: Resource, accountWorkingDays: Weekday[]): Weekday[] {
  const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
  return effectiveWeek.kind === "days" ? effectiveWeek.days : [];
}

/** Distinguishes a blocked working calendar from personal time off. An allocation override may bypass calendars, but it never bypasses time off. */
export type CreationBlockReason = "non-working" | "time-off";

// Share an empty time-off list because move eligibility needs only calendars on the pointer hot path.
const NO_TIME_OFF: TimeOff[] = [];
const NO_CLOSURES: Closure[] = [];

/** The start-of-gesture gate, shared by every surface that asks "may a bar start on this
 * resource-day?" (the model's per-day `creationBlocked`, the grid's draw commit, and the
 * drag/keyboard move paths). Returns the reason so a caller that must tell the two apart can,
 * without re-deriving either rule. `timeOff` need not be pre-filtered by resource. */
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

/** Resolves the creation gate from an already-computed effective week; creation never honors an existing allocation's calendar override. */
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

/** Whether recurring company/personal calendars reject an existing allocation's proposed start.
 * The allocation-level override intentionally bypasses both; time off is a separate conflict. */
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
