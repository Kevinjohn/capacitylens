import { canonicalWeekdaySet } from "./accountWorkingDays";
import { isCapacityTracked, type Resource, type Weekday } from "../types/entities";

/** The recurring weekdays effective for a resource. The `days` variant is guaranteed to contain
 *  at least one weekday, with duplicates removed and values stored in ascending order. */
export type EffectiveWorkingWeek = { kind: "none" } | { kind: "days"; days: Weekday[] };

/** THE membership test for an effective week: false for `none`, so every consumer that asks
 *  "is this weekday effective?" shares one definition instead of re-deriving the discriminant. */
export function effectiveWeekIncludes(effectiveWeek: EffectiveWorkingWeek, weekday: Weekday): boolean {
  return effectiveWeek.kind === "days" && effectiveWeek.days.includes(weekday);
}

/** Whether a normal (calendar-respecting) record placed at `weekday` starts outside the effective
 *  week. Ignore-working-days placements are exempt by definition. Shared by the create/duplicate
 *  gates and the repeat advisory so "non-effective start" has exactly one meaning. */
export function startsOnNonEffectiveWeekday(
  effectiveWeek: EffectiveWorkingWeek,
  ignoreWorkingDays: boolean | undefined,
  weekday: Weekday,
): boolean {
  return !ignoreWorkingDays && !effectiveWeekIncludes(effectiveWeek, weekday);
}

/** Derives the company/personal calendar intersection for capacity-tracked resources. Externals
 *  have no personal capacity pattern, so their effective calendar is the complete company set. */
export function effectiveWorkingWeek(
  resource: Pick<Resource, "kind" | "workingDays">,
  accountWorkingDays: Weekday[],
): EffectiveWorkingWeek {
  const companyWorkingDays = canonicalWeekdaySet(accountWorkingDays);
  let days = companyWorkingDays;
  if (isCapacityTracked(resource)) {
    const personalWorkingDays = new Set(resource.workingDays);
    days = companyWorkingDays.filter((weekday) => personalWorkingDays.has(weekday));
  }

  return days.length === 0 ? { kind: "none" } : { kind: "days", days };
}
