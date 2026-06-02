import { differenceInCalendarDays } from 'date-fns'
import { applyGesture, type DateRange, type DragMode, type GestureOpts } from '../../lib/gestureMath'
import { daysInclusive, parseDate } from '@floaty/shared/lib/dateMath'
import { spanDays } from '@floaty/shared/lib/schedulingDays'
import { MAX_HOURS_PER_DAY } from '@floaty/shared/types/entities'

// Pure drag/resize policy for AllocationBar, split out so the gesture math is unit-testable
// without rendering the bar or driving pointer events. No React, no DOM, no store — the DOM
// hit-testing (snapshotLanes / laneAt / setDropTarget) and the store write + capacity
// advisory stay in the component; this module is only the date/hours/geometry computation.

/** Days-mode resize keeps the VOLUME (days of work) fixed while the span changes, so
 *  hours/day scales inversely with the span: new × newSpan = old × oldSpan.
 *  workingHoursPerDay cancels out, so it isn't needed here. Returns the original hours
 *  when the span can't shrink to zero (guards divide-by-zero), clamped to a real day. */
export function volumePreservingHours(
  prev: DateRange,
  next: DateRange,
  opts: GestureOpts,
  hoursPerDay: number,
): number {
  const oldSpan = spanDays(prev.startDate, prev.endDate, opts)
  const newSpan = spanDays(next.startDate, next.endDate, opts)
  const raw = newSpan > 0 ? (hoursPerDay * oldSpan) / newSpan : hoursPerDay
  // Clamp to a real working day — collapsing the span (e.g. a resize dragged past the
  // opposite edge → 1-day span) would otherwise inflate hours/day without bound.
  return Math.max(0, Math.min(raw, MAX_HOURS_PER_DAY))
}

/** Resolve a gesture (move / resize) into the new date range and hours/day to commit.
 *  The dates come from applyGesture (weekend-aware via opts); in DAYS mode a resize
 *  rescales hours/day to hold the work volume constant, while a move — or an unchanged
 *  span (deltaDays === 0) — keeps the original hours. Mirrors the pointer-commit math so
 *  the source and reassign-target both go through one place. */
export function computeGesture(
  mode: DragMode,
  current: DateRange,
  deltaDays: number,
  opts: GestureOpts,
  hoursPerDay: number,
  isDays: boolean,
): { dates: DateRange; hours: number } {
  const dates = deltaDays !== 0 ? applyGesture(mode, current, deltaDays, opts) : current
  const hours =
    isDays && mode !== 'move' && deltaDays !== 0
      ? volumePreservingHours(current, dates, opts, hoursPerDay)
      : hoursPerDay
  return { dates, hours }
}

/** Pixel geometry for the live drag preview: snap the dates the SAME way the commit will
 *  (applyGesture) and convert back to left/width on the calendar-day grid (each calendar
 *  day = dayWidth, exactly as schedulerModel placed bar.x / bar.width), so the bar doesn't
 *  jump on release. Callers apply this only when deltaDays !== 0 (an unchanged drag keeps
 *  bar.x / bar.width). */
export function snappedBarGeometry(
  mode: DragMode,
  current: DateRange,
  deltaDays: number,
  opts: GestureOpts,
  barX: number,
  dayWidth: number,
): { left: number; width: number } {
  const snapped = applyGesture(mode, current, deltaDays, opts)
  return {
    left: barX + differenceInCalendarDays(parseDate(snapped.startDate), parseDate(current.startDate)) * dayWidth,
    width: daysInclusive(snapped.startDate, snapped.endDate) * dayWidth,
  }
}
