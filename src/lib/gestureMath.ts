import { addDaysISO, countWorkingDays, daysInclusive, endDateForWorkingDays, isWeekendAware } from '@floaty/shared/lib/dateMath'
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
      if (startDate > range.endDate) startDate = range.endDate // keep >= 1 inclusive day
      return { startDate, endDate: range.endDate }
    }
    case 'resize-end': {
      let endDate = addDaysISO(range.endDate, deltaDays)
      if (endDate < range.startDate) endDate = range.startDate
      return { startDate: range.startDate, endDate }
    }
  }
}
