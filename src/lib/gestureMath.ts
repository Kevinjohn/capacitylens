import {
  addDaysISO,
  countWorkingDays,
  daysInclusive,
  endDateForWorkingDays,
  isWeekendAware,
  weekdayOf,
} from "@capacitylens/shared/lib/dateMath";
import type { ISODate, Weekday } from "@capacitylens/shared/types/entities";

// Pure drag/resize math, extracted from the pointer hook so it can be unit
// tested without a DOM. A gesture is: pixels dragged -> whole-day delta (snap)
// -> new inclusive [start, end]. Resizes keep a minimum 1-day duration.

export type DragMode = "move" | "resize-start" | "resize-end";

export interface DateRange {
  startDate: ISODate;
  endDate: ISODate;
}

/** Weekend-awareness for a move gesture. When `ignoreWeekends` is false and
 *  `workingDays` doesn't cover the whole week, a move preserves the allocation's
 *  *working-day* count by extending its end across non-working days. Omit (or
 *  set `ignoreWeekends`) to get the plain calendar-shift behavior. */
export interface GestureOpts {
  workingDays?: Weekday[];
  ignoreWeekends?: boolean;
}

/** Which way along the calendar a step runs: +1 forward, -1 backward. */
type Direction = 1 | -1;

/** Step `date` to the nearest working day in `direction` (+1 forward, -1 backward),
 *  returning it unchanged when it's already a working day. Keeps a weekend-aware resize
 *  edge off non-working days. Bounded to a week so an empty working set can't loop (it
 *  falls through to a full week's shift, as the day-by-day scan this replaced did).
 *
 *  Steps the WEEKDAY arithmetically and converts to a date ONCE: probing each candidate with
 *  `weekdayOf` cost a parseISO + a format per day (up to 7 round-trips), and this runs on every
 *  pointer move of a weekend-aware drag. */
function snapToWorkingDay(date: ISODate, workingDays: Weekday[], direction: Direction): ISODate {
  let weekday = weekdayOf(date);
  for (let offset = 0; offset < 7; offset++) {
    if (workingDays.includes(weekday)) return offset === 0 ? date : addDaysISO(date, offset * direction);
    weekday = ((weekday + direction + 7) % 7) as Weekday;
  }
  return addDaysISO(date, 7 * direction);
}

/** Is `date` past `limit` when travelling in `direction`? */
function isPast(date: ISODate, limit: ISODate, direction: Direction): boolean {
  return direction === 1 ? date > limit : date < limit;
}

/** The new position of ONE dragged resize edge. Both edges run through here: they were
 *  hand-mirrored copies — down to the pin-and-re-snap over-drag fix — so the next correction
 *  could easily have landed in only one of them. `weekendAwareDays` is non-null only when the
 *  gesture is weekend-aware (see `applyGesture`). */
function resizedEdge(
  range: DateRange,
  deltaDays: number,
  edge: "start" | "end",
  weekendAwareDays: Weekday[] | null,
): ISODate {
  // The opposite edge is the one an over-drag collapses onto; `toAnchor` is the direction it
  // lies in, `toOrigin` the way back to where this edge started.
  const toAnchor: Direction = edge === "start" ? 1 : -1;
  const toOrigin: Direction = edge === "start" ? -1 : 1;
  const anchor = edge === "start" ? range.endDate : range.startDate;
  const origin = edge === "start" ? range.startDate : range.endDate;
  let moved = addDaysISO(origin, deltaDays);
  // Weekend-aware: keep the dragged edge off non-working days (snap in the drag's direction),
  // mirroring the move branch — otherwise a resize lands a weekend at the bar's edge and, in
  // days mode, desyncs the calendar span from the working-day count. A zero-delta drag is a no-op.
  const snapDays = deltaDays === 0 ? null : weekendAwareDays;
  if (snapDays) moved = snapToWorkingDay(moved, snapDays, deltaDays > 0 ? 1 : -1);
  if (isPast(moved, anchor, toAnchor)) {
    // Over-dragged past the opposite edge: pin to it, but when weekend-aware snap that pin BACK
    // onto a working day — else the edge lands on a non-working day and the days-mode span
    // collapses to zero working days (silently keeping old hours). Never past this edge's origin.
    const pinned = snapDays ? snapToWorkingDay(anchor, snapDays, toOrigin) : anchor;
    moved = isPast(pinned, origin, toOrigin) ? origin : pinned;
  }
  return moved;
}

export function applyGesture(mode: DragMode, range: DateRange, deltaDays: number, opts?: GestureOpts): DateRange {
  // Resolve weekend-awareness ONCE for the whole gesture: non-null exactly when the resource has a
  // partial working week and the allocation hasn't opted out. Carrying the working-day array rather
  // than a boolean is what lets every branch below drop the `opts!.workingDays!` assertions.
  const weekendAwareDays = isWeekendAware(opts?.workingDays, opts?.ignoreWeekends) ? (opts?.workingDays ?? null) : null;
  switch (mode) {
    case "move": {
      let newStart = addDaysISO(range.startDate, deltaDays);
      // Not weekend-aware: plain calendar shift.
      if (!weekendAwareDays) {
        return { startDate: newStart, endDate: addDaysISO(range.endDate, deltaDays) };
      }
      const w = countWorkingDays(range.startDate, range.endDate, weekendAwareDays);
      // Keep the leading edge on a day where the allocation actually performs work. A zero-delta
      // gesture remains a strict no-op, and a legacy all-non-working range keeps its calendar shape
      // because it has no working edge to preserve.
      if (deltaDays !== 0 && w > 0) {
        newStart = snapToWorkingDay(newStart, weekendAwareDays, deltaDays > 0 ? 1 : -1);
      }
      const newEnd =
        w > 0
          ? endDateForWorkingDays(newStart, w, weekendAwareDays)
          : // Range had no working days at all — preserve its calendar span.
            addDaysISO(newStart, daysInclusive(range.startDate, range.endDate) - 1);
      return { startDate: newStart, endDate: newEnd };
    }
    case "resize-start":
      return { startDate: resizedEdge(range, deltaDays, "start", weekendAwareDays), endDate: range.endDate };
    case "resize-end":
      return { startDate: range.startDate, endDate: resizedEdge(range, deltaDays, "end", weekendAwareDays) };
  }
}
