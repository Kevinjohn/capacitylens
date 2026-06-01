import { addDaysISO, countWorkingDays, daysInclusive, endDateForWorkingDays, isWeekendAware, weekdayOf } from '@floaty/shared/lib/dateMath'
import type { ISODate, Weekday } from '@floaty/shared/types/entities'

// Pure drag/resize math, extracted from the pointer hook so it can be unit
// tested without a DOM. A gesture is: pixels dragged -> whole-day delta (snap)
// -> new inclusive [start, end]. Resizes keep a minimum 1-day duration.

export type DragMode = 'move' | 'resize-start' | 'resize-end'

export interface DateRange {
  startDate: ISODate
  endDate: ISODate
}

/** Weekend-awareness for a move gesture. When `ignoreWeekends` is false and
 *  `workingDays` doesn't cover the whole week, a move preserves the allocation's
 *  *working-day* count by extending its end across non-working days. Omit (or
 *  set `ignoreWeekends`) to get the plain calendar-shift behavior. */
export interface GestureOpts {
  workingDays?: Weekday[]
  ignoreWeekends?: boolean
}

/** Snap a pixel delta to a whole number of days. */
export function snapDeltaToDays(deltaPx: number, dayWidth: number): number {
  if (dayWidth <= 0) return 0
  return Math.round(deltaPx / dayWidth)
}

/** Step `date` to the nearest working day in `direction` (+1 forward, -1 backward),
 *  returning it unchanged when it's already a working day. Keeps a weekend-aware resize
 *  edge off non-working days. Bounded to a week so an empty working set can't loop. */
function snapToWorkingDay(date: ISODate, workingDays: Weekday[], direction: 1 | -1): ISODate {
  let d = date
  for (let i = 0; i < 7 && !workingDays.includes(weekdayOf(d)); i++) {
    d = addDaysISO(d, direction)
  }
  return d
}

export function applyGesture(
  mode: DragMode,
  range: DateRange,
  deltaDays: number,
  opts?: GestureOpts,
): DateRange {
  switch (mode) {
    case 'move': {
      const newStart = addDaysISO(range.startDate, deltaDays)
      const workingDays = opts?.workingDays
      // Weekend-aware only when we have a partial working week and the
      // allocation hasn't opted out. Otherwise: plain calendar shift.
      const weekendAware = isWeekendAware(workingDays, opts?.ignoreWeekends)
      if (!weekendAware) {
        return { startDate: newStart, endDate: addDaysISO(range.endDate, deltaDays) }
      }
      const w = countWorkingDays(range.startDate, range.endDate, workingDays!)
      const newEnd =
        w > 0
          ? endDateForWorkingDays(newStart, w, workingDays!)
          : // Range had no working days at all — preserve its calendar span.
            addDaysISO(newStart, daysInclusive(range.startDate, range.endDate) - 1)
      return { startDate: newStart, endDate: newEnd }
    }
    case 'resize-start': {
      let startDate = addDaysISO(range.startDate, deltaDays)
      // Weekend-aware: keep the dragged edge off non-working days (snap in the drag's
      // direction), mirroring the move branch — otherwise a resize lands a weekend at the
      // bar's edge and, in days mode, desyncs the calendar span from the working-day count.
      const weekendAware = deltaDays !== 0 && isWeekendAware(opts?.workingDays, opts?.ignoreWeekends)
      if (weekendAware) {
        startDate = snapToWorkingDay(startDate, opts!.workingDays!, deltaDays > 0 ? 1 : -1)
      }
      if (startDate > range.endDate) {
        // Over-dragged past the end: pin to the end, but when weekend-aware snap that pin
        // BACK onto a working day — else the start lands on a non-working `endDate` and the
        // days-mode span collapses to zero working days (silently keeping old hours).
        startDate = weekendAware ? snapToWorkingDay(range.endDate, opts!.workingDays!, -1) : range.endDate
      }
      return { startDate, endDate: range.endDate }
    }
    case 'resize-end': {
      let endDate = addDaysISO(range.endDate, deltaDays)
      const weekendAware = deltaDays !== 0 && isWeekendAware(opts?.workingDays, opts?.ignoreWeekends)
      if (weekendAware) {
        endDate = snapToWorkingDay(endDate, opts!.workingDays!, deltaDays > 0 ? 1 : -1)
      }
      if (endDate < range.startDate) {
        // Symmetric to resize-start: pin to the start, snapped FORWARD to a working day when
        // weekend-aware so the edge never sits on a weekend / zeroes the working-day span.
        endDate = weekendAware ? snapToWorkingDay(range.startDate, opts!.workingDays!, 1) : range.startDate
      }
      return { startDate: range.startDate, endDate }
    }
  }
}
