import { canonicalWeekdaySet } from "./accountWorkingDays";
import type { Resource, Weekday } from "../types/entities";

/** The recurring weekdays effective for a resource. The `days` variant is guaranteed to contain
 *  at least one weekday, with duplicates removed and values stored in ascending order. */
export type EffectiveWorkingWeek = { kind: "none" } | { kind: "days"; days: Weekday[] };

/** THE membership test for an effective week: false for `none`, so every consumer that asks
 *  "is this weekday effective?" shares one definition instead of re-deriving the discriminant. */
export function effectiveWeekIncludes(effectiveWeek: EffectiveWorkingWeek, weekday: Weekday): boolean {
  return effectiveWeek.kind === "days" && effectiveWeek.days.includes(weekday);
}

/** Whether a normal (calendar-respecting) record placed at `weekday` starts outside the effective
 *  week. Ignore-working-days placements are exempt by definition — which is why this is the
 *  ADVISORY test (repeat occurrences), never the creation gate: creation has no ignored-creation
 *  escape hatch and uses creationBlockedAt/creationBlockedForEffectiveWeek instead. */
export function startsOnNonEffectiveWeekday(
  effectiveWeek: EffectiveWorkingWeek,
  ignoreWorkingDays: boolean | undefined,
  weekday: Weekday,
): boolean {
  return !ignoreWorkingDays && !effectiveWeekIncludes(effectiveWeek, weekday);
}

/** The ONE predicate for a normal allocation that cannot use working-span math, because feeding
 *  `none` into date math means calendar-day semantics or a 9999-12-31 end date. An ignored
 *  allocation always spans calendar days, so it is exempt. */
export function lacksEffectiveWorkingDays(
  effectiveWeek: EffectiveWorkingWeek | null | undefined,
  ignoreWorkingDays: boolean | undefined,
): boolean {
  return effectiveWeek?.kind !== "days" && !ignoreWorkingDays;
}

/** Derives the company/personal calendar intersection for people. Placeholders and externals have
 *  no personal capacity pattern, so their effective calendar is the complete company set. */
export function effectiveWorkingWeek(
  resource: Pick<Resource, "kind" | "workingDays">,
  accountWorkingDays: Weekday[],
): EffectiveWorkingWeek {
  const companyWorkingDays = canonicalWeekdaySet(accountWorkingDays);
  let days = companyWorkingDays;
  if (resource.kind === "person") {
    const personalWorkingDays = new Set(resource.workingDays);
    days = companyWorkingDays.filter((weekday) => personalWorkingDays.has(weekday));
  }

  return days.length === 0 ? { kind: "none" } : { kind: "days", days };
}
