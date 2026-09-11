import {
  addDaysISO,
  daysInclusive,
  endDateForWorkingDays,
  isWeekendAware,
  weekdayOf,
} from "@capacitylens/shared/lib/dateMath";
import { spanDays } from "@capacitylens/shared/lib/schedulingDays";
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
  /** How long the range is in the ORIGIN's units; 0 when the origin has no duration to carry. */
  sourceSpan: number;
  /** True when the two weeks differ, i.e. the move re-places the range in a calendar that did not
   *  produce it. A same-resource move leaves this false and keeps its existing behaviour exactly. */
  placesIntoAnotherWeek: boolean;
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

// Measure against the ORIGIN, place against the DESTINATION. Measuring under the destination
// instead would reinterpret the old dates in a calendar that never produced them: two days of work
// on a Tue/Thu week read as four on a Mon-Fri one, and the bar refuses to shrink. When both weeks
// count in the same units — two full weeks, or an allocation that ignores them — this reduces to
// the plain calendar shift it has always been.
function applyMove({ range, deltaDays, sourceSpan, placesIntoAnotherWeek, targetDays }: ApplyMoveInput): DateRange {
  const shiftedStart = addDaysISO(range.startDate, deltaDays);
  // The DESTINATION's week decides where the range starts. An origin with nothing to carry must
  // still snap when it is being placed in a DIFFERENT week: a start the destination does not work
  // is refused at commit, so leaving it unsnapped turns the drop into a rejection toast. Within one
  // week there is nothing to re-place, and a range already sitting on non-working days stays put.
  const snaps = deltaDays !== 0 && targetDays && (sourceSpan > 0 || placesIntoAnotherWeek);
  const newStart = snaps ? snapToWorkingDay(shiftedStart, targetDays, deltaDays > 0 ? 1 : -1) : shiftedStart;
  // An origin with no duration to carry — its range lands entirely on days it does not work, or
  // its working week has collapsed to none at all. Preserving the raw calendar span is the only
  // non-destructive answer; re-placing a zero span would silently delete the booking.
  const span = sourceSpan > 0 ? sourceSpan : daysInclusive(range.startDate, range.endDate);
  const placeUnderTarget = sourceSpan > 0 && targetDays;
  // The inverse of `spanDays`, written out rather than borrowed from `endDateForSpan`: that one
  // clamps the span to the date domain, and a gesture should surface an impossible drag as the
  // store's rejection rather than silently land somewhere the pointer never went.
  const newEnd = placeUnderTarget
    ? endDateForWorkingDays(newStart, span, placeUnderTarget)
    : addDaysISO(newStart, span - 1);
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
function resolveWeekendAwareWeek(days: Weekday[] | undefined, ignoreWeekends: boolean | undefined): Weekday[] | null {
  return isWeekendAware(days, ignoreWeekends) ? (days ?? null) : null;
}

/** Do two resolved weeks describe the same working days? A same-resource move reads its week twice
 *  and gets two equal-but-distinct arrays, so identity alone cannot answer this. */
function isSameWeek(a: Weekday[] | null, b: Weekday[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((day) => b.includes(day));
}

/** The duration a move carries away from its ORIGIN. A collapsed working week (no effective days at
 *  all) reports 0 rather than a calendar span: `resolveWeekendAwareWeek` cannot tell it apart from a full
 *  seven-day week, and treating "works no day" as "works every day" would inflate the booking. */
function resolveMoveSpan(range: DateRange, options: GestureOptions | undefined): number {
  const workingDays = options?.sourceWorkingDays ?? options?.workingDays;
  if (workingDays?.length === 0 && !options?.ignoreWeekends) return 0;
  // `spanDays` owns the working-days-versus-calendar-days split for the whole product; measuring
  // through it is what keeps a dragged duration and a typed one meaning the same thing.
  return spanDays(range.startDate, range.endDate, {
    ...(workingDays ? { workingDays } : {}),
    ...(options?.ignoreWeekends !== undefined ? { ignoreWeekends: options.ignoreWeekends } : {}),
  });
}

export function applyGesture({ mode, range, deltaDays, options }: ApplyGestureInput): DateRange {
  // Resolve weekend-awareness ONCE for the whole gesture. A resize only ever sees one week; a move
  // sees two, and absent a source week it stays on one resource, so both of its ends are the same
  // calendar and every existing caller keeps its behaviour untouched.
  const weekendAwareDays = resolveWeekendAwareWeek(options?.workingDays, options?.ignoreWeekends);
  switch (mode) {
    case "move":
      return applyMove({
        range,
        deltaDays,
        sourceSpan: resolveMoveSpan(range, options),
        placesIntoAnotherWeek: !isSameWeek(
          resolveWeekendAwareWeek(options?.sourceWorkingDays ?? options?.workingDays, options?.ignoreWeekends),
          weekendAwareDays,
        ),
        targetDays: weekendAwareDays,
      });
    case "resize-start":
    case "resize-end":
      return applyResize({ mode, range, deltaDays, weekendAwareDays });
  }
}
