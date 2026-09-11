import {
  addDaysISO,
  countWorkingDays,
  daysInclusive,
  endDateForWorkingDays,
  isWeekendAware,
  weekdayOf,
} from "@capacitylens/shared/lib/dateMath";
import type { ISODate, Weekday } from "@capacitylens/shared/types/entities";

interface ResolveResizedEdgeInput {
  range: DateRange;
  deltaDays: number;
  edge: "start" | "end";
  weekendAwareDays: Weekday[] | null;
}

interface ApplyGestureInput {
  mode: DragMode;
  range: DateRange;
  deltaDays: number;
  options?: GestureOptions | undefined;
}

interface ApplyMoveInput {
  range: DateRange;
  deltaDays: number;
  sourceDays: Weekday[] | null;
  targetDays: Weekday[] | null;
}

interface ApplyResizeInput {
  mode: "resize-start" | "resize-end";
  range: DateRange;
  deltaDays: number;
  weekendAwareDays: Weekday[] | null;
}

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
export interface GestureOptions {
  /** The DESTINATION's working week: where the moved range is placed, and the only week a resize
   *  ever sees. */
  workingDays?: Weekday[];
  /** The ORIGIN's working week, when a move crosses rows. A reassignment keeps the allocation's
   *  duration as its own resource measured it and re-places that duration in the target's calendar,
   *  so the two weeks answer different questions: this one sizes the range, `workingDays` positions
   *  it. Omit for a same-resource gesture, where the two are the same week. */
  sourceWorkingDays?: Weekday[];
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
function resolveResizedEdge({ range, deltaDays, edge, weekendAwareDays }: ResolveResizedEdgeInput): ISODate {
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

/** How long the range is, in the units the given week counts in: working days when that week is
 *  weekend-aware, otherwise inclusive calendar days. The same split `spanDays` uses, so the two
 *  cannot disagree about what one "day" of an allocation is. */
function spanUnderWeek(range: DateRange, days: Weekday[] | null): number {
  return days ? countWorkingDays(range.startDate, range.endDate, days) : daysInclusive(range.startDate, range.endDate);
}

/** Inverse of `spanUnderWeek`: the inclusive end that makes [start, end] `span` units long. */
function endForSpanUnderWeek(start: ISODate, span: number, days: Weekday[] | null): ISODate {
  return days ? endDateForWorkingDays(start, span, days) : addDaysISO(start, span - 1);
}

function applyMove({ range, deltaDays, sourceDays, targetDays }: ApplyMoveInput): DateRange {
  const shiftedStart = addDaysISO(range.startDate, deltaDays);
  if (!sourceDays && !targetDays) return { startDate: shiftedStart, endDate: addDaysISO(range.endDate, deltaDays) };

  // Measure against the ORIGIN, place against the DESTINATION. Measuring under the destination
  // instead would reinterpret the old dates in a calendar that never produced them: two days of
  // work on a Tue/Thu week read as four on a Mon-Fri one, and the bar refuses to shrink.
  const span = spanUnderWeek(range, sourceDays);
  const newStart =
    deltaDays !== 0 && span > 0 && targetDays
      ? snapToWorkingDay(shiftedStart, targetDays, deltaDays > 0 ? 1 : -1)
      : shiftedStart;
  const newEnd =
    span > 0
      ? endForSpanUnderWeek(newStart, span, targetDays)
      : // A weekend-aware origin whose range lands entirely on its non-working days has no duration
        // to carry. Preserving the raw calendar span is the only non-destructive answer.
        addDaysISO(newStart, daysInclusive(range.startDate, range.endDate) - 1);
  return { startDate: newStart, endDate: newEnd };
}

function applyResize({ mode, range, deltaDays, weekendAwareDays }: ApplyResizeInput): DateRange {
  const edge = mode === "resize-start" ? "start" : "end";
  const moved = resolveResizedEdge({ range, deltaDays, edge, weekendAwareDays });
  return edge === "start"
    ? { startDate: moved, endDate: range.endDate }
    : { startDate: range.startDate, endDate: moved };
}

/** The week a gesture must respect, or `null` when it may treat every calendar day alike: a full or
 *  empty working week, or an allocation that opted out. Returning the array rather than a boolean is
 *  what lets every branch below drop the `options!.workingDays!` assertions. */
function weekendAwareWeek(days: Weekday[] | undefined, ignoreWeekends: boolean | undefined): Weekday[] | null {
  return isWeekendAware(days, ignoreWeekends) ? (days ?? null) : null;
}

export function applyGesture({ mode, range, deltaDays, options }: ApplyGestureInput): DateRange {
  // Resolve weekend-awareness ONCE for the whole gesture. A resize only ever sees one week; a move
  // sees two, and absent a source week it stays on one resource, so both of its ends are the same
  // calendar and every existing caller keeps its behaviour untouched.
  const weekendAwareDays = weekendAwareWeek(options?.workingDays, options?.ignoreWeekends);
  switch (mode) {
    case "move":
      return applyMove({
        range,
        deltaDays,
        sourceDays: weekendAwareWeek(options?.sourceWorkingDays ?? options?.workingDays, options?.ignoreWeekends),
        targetDays: weekendAwareDays,
      });
    case "resize-start":
    case "resize-end":
      return applyResize({ mode, range, deltaDays, weekendAwareDays });
  }
}
