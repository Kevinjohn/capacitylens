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
  // Range duration measured in the origin's calendar; zero means there is no work duration to carry.
  sourceSpan: number;
  // True when a move crosses calendars and must place the range in the destination's working week.
  placesIntoAnotherWeek: boolean;
  targetDays: Weekday[] | null;
}

interface ApplyResizeInput {
  mode: "resize-start" | "resize-end";
  range: DateRange;
  deltaDays: number;
  weekendAwareDays: Weekday[] | null;
}

/** Pointer gesture operation applied to a schedule date range. */
export type DragMode = "move" | "resize-start" | "resize-end";

/** Inclusive start and end dates for a schedule gesture. */
export interface DateRange {
  startDate: ISODate;
  endDate: ISODate;
}

/** Weekend-awareness for a move gesture. When `ignoreWeekends` is false and
 * `workingDays` doesn't cover the whole week, a move preserves the allocation's
 * *working-day* count by extending its end across non-working days. Omit (or
 * set `ignoreWeekends`) to get the plain calendar-shift behavior. */
export interface GestureOptions {
  /** The destination's working week: where the moved range is placed, and the only week a resize
   * ever sees. */
  workingDays?: Weekday[];
  /** The origin's working week, when a move crosses rows. A reassignment keeps the allocation's
   * duration as its own resource measured it and re-places that duration in the target's calendar,
   * so the two weeks answer different questions: this one sizes the range, `workingDays` positions
   * it. Omit for a same-resource gesture, where the two are the same week. */
  sourceWorkingDays?: Weekday[];
  ignoreWeekends?: boolean;
}

type Direction = 1 | -1;

// Search at most one week so an empty workweek cannot loop. Arithmetic weekday steps avoid parsing
// and formatting a date for every candidate on each pointer move.
function snapToWorkingDay(date: ISODate, workingDays: Weekday[], direction: Direction): ISODate {
  let weekday = weekdayOf(date);
  for (let offset = 0; offset < 7; offset++) {
    if (workingDays.includes(weekday)) return offset === 0 ? date : addDaysISO(date, offset * direction);
    weekday = ((weekday + direction + 7) % 7) as Weekday;
  }
  return addDaysISO(date, 7 * direction);
}

function isPast(date: ISODate, limit: ISODate, direction: Direction): boolean {
  return direction === 1 ? date > limit : date < limit;
}

// Use one clamp path for both edges so weekend-aware resize behavior stays symmetric.
function resolveResizedEdge({ range, deltaDays, edge, weekendAwareDays }: ResolveResizedEdgeInput): ISODate {
  // The opposite edge is the one an over-drag collapses onto; `toAnchor` is the direction it
  // lies in, `toOrigin` the way back to where this edge started.
  const toAnchor: Direction = edge === "start" ? 1 : -1;
  const toOrigin: Direction = edge === "start" ? -1 : 1;
  const anchor = edge === "start" ? range.endDate : range.startDate;
  const origin = edge === "start" ? range.startDate : range.endDate;
  let moved = addDaysISO(origin, deltaDays);
  // Weekend-aware: keep the dragged edge off non-working days (snap in the drag's direction),
  // mirroring the move branch; otherwise a resize lands a weekend at the bar's edge and, in
  // days mode, desyncs the calendar span from the working-day count. A zero-delta drag is a no-op.
  const snapDays = deltaDays === 0 ? null : weekendAwareDays;
  if (snapDays) moved = snapToWorkingDay(moved, snapDays, deltaDays > 0 ? 1 : -1);
  if (isPast(moved, anchor, toAnchor)) {
    // Over-dragged past the opposite edge: pin to it, but when weekend-aware snap that pin back
    // onto a working day; else the edge lands on a non-working day and the days-mode span
    // collapses to zero working days and leaves stored hours unchanged. Never past this edge's origin.
    const pinned = snapDays ? snapToWorkingDay(anchor, snapDays, toOrigin) : anchor;
    moved = isPast(pinned, origin, toOrigin) ? origin : pinned;
  }
  return moved;
}

// Measure in the origin's calendar, then place in the destination's calendar. Measuring in the
// destination's week can change the duration because the source dates may represent different
// working-day counts there. When both calendars treat every day as a working day, the move is a calendar shift.
function applyMove({ range, deltaDays, sourceSpan, placesIntoAnotherWeek, targetDays }: ApplyMoveInput): DateRange {
  const shiftedStart = addDaysISO(range.startDate, deltaDays);
  // The destination's week decides where the range starts. An origin with nothing to carry must
  // still snap when it is being placed in a different week: a start the destination does not work
  // is refused at commit, so leaving it unsnapped turns the drop into a rejection toast. Within one
  // week there is nothing to re-place, and a range already sitting on non-working days stays put.
  const snaps = deltaDays !== 0 && targetDays && (sourceSpan > 0 || placesIntoAnotherWeek);
  const newStart = snaps ? snapToWorkingDay(shiftedStart, targetDays, deltaDays > 0 ? 1 : -1) : shiftedStart;
  // An origin with no duration to carry: its range lands entirely on days it does not work, or
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

// Return the working days only when the gesture must respect a partial workweek.
type ResolveWeekendAwareWeekOptions = { days: Weekday[] | undefined; ignoreWeekends: boolean | undefined };
function resolveWeekendAwareWeek({ days, ignoreWeekends }: ResolveWeekendAwareWeekOptions): Weekday[] | null {
  return isWeekendAware(days, ignoreWeekends) ? (days ?? null) : null;
}

// Compare week contents because same-resource moves may receive equal but distinct arrays.
function isSameWeek(a: Weekday[] | null, b: Weekday[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((day) => b.includes(day));
}

// A week with no effective workdays carries no duration; treating it as a full week would inflate
// the booking because resolveWeekendAwareWeek returns null for both full and empty workweeks.
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

/** Applies a snapped move or resize to an inclusive date range. */
export function applyGesture({ mode, range, deltaDays, options }: ApplyGestureInput): DateRange {
  // Resolve weekend awareness once; cross-resource moves may use distinct source and destination weeks.
  const weekendAwareDays = resolveWeekendAwareWeek({
    days: options?.workingDays,
    ignoreWeekends: options?.ignoreWeekends,
  });
  switch (mode) {
    case "move":
      return applyMove({
        range,
        deltaDays,
        sourceSpan: resolveMoveSpan(range, options),
        placesIntoAnotherWeek: !isSameWeek(
          resolveWeekendAwareWeek({
            days: options?.sourceWorkingDays ?? options?.workingDays,
            ignoreWeekends: options?.ignoreWeekends,
          }),
          weekendAwareDays,
        ),
        targetDays: weekendAwareDays,
      });
    case "resize-start":
    case "resize-end":
      return applyResize({ mode, range, deltaDays, weekendAwareDays });
  }
}
