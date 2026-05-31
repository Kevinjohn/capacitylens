import { addDaysISO } from '@floaty/shared/lib/dateMath'
import type { ISODate } from '@floaty/shared/types/entities'

// Pure drag/resize math, extracted from the pointer hook so it can be unit
// tested without a DOM. A gesture is: pixels dragged -> whole-day delta (snap)
// -> new inclusive [start, end]. Resizes keep a minimum 1-day duration.

export type DragMode = 'move' | 'resize-start' | 'resize-end'

export interface DateRange {
  startDate: ISODate
  endDate: ISODate
}

/** Snap a pixel delta to a whole number of days. */
export function snapDeltaToDays(deltaPx: number, dayWidth: number): number {
  if (dayWidth <= 0) return 0
  return Math.round(deltaPx / dayWidth)
}

export function applyGesture(mode: DragMode, range: DateRange, deltaDays: number): DateRange {
  switch (mode) {
    case 'move':
      return {
        startDate: addDaysISO(range.startDate, deltaDays),
        endDate: addDaysISO(range.endDate, deltaDays),
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
