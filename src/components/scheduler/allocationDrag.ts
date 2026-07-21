import { applyGesture, type DateRange, type DragMode, type GestureOpts } from '../../lib/gestureMath'
import { spanDays } from '@capacitylens/shared/lib/schedulingDays'
import { isExternalResource, MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities'
import type { Resource } from '@capacitylens/shared/types/entities'
import type { ColumnGeometry } from './columnGeometry'

// Pure drag/resize policy for AllocationBar, split out so the gesture math is unit-testable
// without rendering the bar or driving pointer events. No React, no DOM, no store — the DOM
// hit-testing (snapshotLanes / laneAt / setDropTarget) and the store write + capacity
// advisory stay in the component; this module is only the date/hours/geometry computation.

/** Hours/day an allocation should carry after being REASSIGNED (dragged) to `target`. The TARGET's
 *  kind decides: an external / 3rd party carries no load (0); a real resource must carry > 0, so a
 *  0-hour booking dragged OFF an external is given the target's working day (else it persists an
 *  illegal 0-hour allocation the modal rejects). `current` (the source's hours) is kept for a
 *  real→real reassign. A same-resource move never calls this. */
export function reconcileReassignedHours(current: number, target: Resource): number {
  if (isExternalResource(target)) return 0
  return current > 0 ? current : target.workingHoursPerDay
}

/** Days-mode resize keeps the VOLUME (days of work) fixed while the span changes, so
 *  hours/day scales inversely with the span: new × newSpan = old × oldSpan.
 *  workingHoursPerDay cancels out, so it isn't needed here. Returns the clamped hours
 *  AND whether the clamp actually bit, so a gesture commit can surface the lost volume
 *  (the cap truncates work — the bar would otherwise silently show the clamped 24h).
 *  `clamped` is true ONLY when the raw derived hours exceeded MAX_HOURS_PER_DAY; a
 *  normal in-range resize, a move, the divide-by-zero guard, and the zero-old-span guard
 *  all report false. */
export function volumePreservingHoursClamped(
  prev: DateRange,
  next: DateRange,
  opts: GestureOpts,
  hoursPerDay: number,
): { hours: number; clamped: boolean } {
  const oldSpan = spanDays(prev.startDate, prev.endDate, opts)
  const newSpan = spanDays(next.startDate, next.endDate, opts)
  // A zero-working-day OLD span (e.g. a weekend-aware allocation currently covering only Sat–Sun)
  // has no volume to preserve — `hoursPerDay * 0 / newSpan` is 0, and committing that would
  // silently wipe the stored hours the moment the resize lands on a working day. Preserving the
  // existing value is the only non-destructive choice (no defaulting to 8, no clamping).
  const raw = oldSpan === 0 ? hoursPerDay : newSpan > 0 ? (hoursPerDay * oldSpan) / newSpan : hoursPerDay
  // Clamp to a real working day — collapsing the span (e.g. a resize dragged past the
  // opposite edge → 1-day span) would otherwise inflate hours/day without bound.
  return { hours: Math.max(0, Math.min(raw, MAX_HOURS_PER_DAY)), clamped: raw > MAX_HOURS_PER_DAY }
}

/** Resolve a gesture (move / resize) into the new date range and hours/day to commit.
 *  The dates come from applyGesture (weekend-aware via opts); in DAYS mode a resize
 *  rescales hours/day to hold the work volume constant, while a move — or an unchanged
 *  span (deltaDays === 0) — keeps the original hours. Mirrors the pointer-commit math so
 *  the source and reassign-target both go through one place. `clamped` reports whether a
 *  volume-preserving resize hit the 24h cap (truncating work volume), so the commit can
 *  surface it; it's false for a move and any non-rescaling path. */
export function computeGesture(
  mode: DragMode,
  current: DateRange,
  deltaDays: number,
  opts: GestureOpts,
  hoursPerDay: number,
  isDays: boolean,
): { dates: DateRange; hours: number; clamped: boolean } {
  const dates = deltaDays !== 0 ? applyGesture(mode, current, deltaDays, opts) : current
  if (isDays && mode !== 'move' && deltaDays !== 0) {
    const { hours, clamped } = volumePreservingHoursClamped(current, dates, opts, hoursPerDay)
    return { dates, hours, clamped }
  }
  return { dates, hours: hoursPerDay, clamped: false }
}

/** Pixel geometry for the live drag preview: snap the dates the SAME way the commit will
 *  (applyGesture), then run them through the SAME ColumnGeometry the view-model used to place
 *  bar.x / bar.width. Going through one geometry is what keeps the bar from jumping on release —
 *  even when the snapped range crosses a narrowed weekend, the preview is pixel-identical to the
 *  committed bar. Callers apply this only when deltaDays !== 0 (an unchanged drag keeps bar.x /
 *  bar.width). */
export function snappedBarGeometry(
  mode: DragMode,
  current: DateRange,
  deltaDays: number,
  opts: GestureOpts,
  geom: ColumnGeometry,
): { left: number; width: number } {
  const snapped = applyGesture(mode, current, deltaDays, opts)
  return {
    left: geom.xForDateInGeom(snapped.startDate),
    width: geom.widthForDates(snapped.startDate, snapped.endDate),
  }
}
