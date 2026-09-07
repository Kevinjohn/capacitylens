import { applyGesture, type DateRange, type DragMode, type GestureOptions } from "../../lib/gestureMath";
import { resolveScheduledHoursOnDay } from "../../lib/capacity";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { spanDays } from "@capacitylens/shared/lib/schedulingDays";
import { FULL_DAY_HOURS, isExternalResource, MAX_HOURS_PER_DAY } from "@capacitylens/shared/types/entities";
import type { ISODate, Resource } from "@capacitylens/shared/types/entities";
import type { ColumnGeometry } from "./columnGeometry";

// Pure drag/resize policy for AllocationBar, split out so the gesture math is unit-testable
// without rendering the bar or driving pointer events. No React, no DOM, no store — the DOM
// hit-testing (readLaneSnapshots / laneAt / setDropTarget) and the store write + capacity
// advisory stay in the component; this module is only the date/hours/geometry computation.

/** Hours/day an allocation should carry after being REASSIGNED (dragged) to `target`. An external
 *  / 3rd party always carries no load (0). In Hours/Days mode, a zero-hour booking dragged OFF an
 *  external is promoted to the target's working day because those forms require positive load.
 *  Blocks mode deliberately permits and preserves zero; existing positive historical values are
 *  also retained for a real→real reassign. A same-resource move never calls this. */
export function reconcileReassignedHours(
  current: number,
  target: Resource,
  zeroLoadMode: boolean,
  startDate: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  if (isExternalResource(target)) return 0;
  if (current > 0 || zeroLoadMode) return current;
  return resolveScheduledHoursOnDay(target, startDate, effectiveWeek) || FULL_DAY_HOURS;
}

/** Days-mode resize keeps the VOLUME (days of work) fixed while the span changes, so
 *  hours/day scales inversely with the span: new × newSpan = old × oldSpan.
 *  the fixed full-day hours cancel out, so they aren't needed here. Returns the clamped hours
 *  AND whether the clamp actually bit, so a gesture commit can surface the lost volume
 *  (the cap truncates work — the bar would otherwise silently show the clamped 24h).
 *  `clamped` is true ONLY when the raw derived hours exceeded MAX_HOURS_PER_DAY; a
 *  normal in-range resize, a move, the divide-by-zero guard, and the zero-old-span guard
 *  all report false. */
export function resolveVolumePreservingHours(
  previousDate: DateRange,
  next: DateRange,
  options: GestureOptions,
  hoursPerDay: number,
): { hours: number; clamped: boolean } {
  const oldSpan = spanDays(previousDate.startDate, previousDate.endDate, options);
  const newSpan = spanDays(next.startDate, next.endDate, options);
  // A zero-working-day OLD span (e.g. a weekend-aware allocation currently covering only Sat–Sun)
  // has no volume to preserve — `hoursPerDay * 0 / newSpan` is 0, and committing that would
  // silently wipe the stored hours the moment the resize lands on a working day. Preserving the
  // existing value is the only non-destructive choice (no defaulting to 8, no clamping).
  const raw = oldSpan === 0 ? hoursPerDay : newSpan > 0 ? (hoursPerDay * oldSpan) / newSpan : hoursPerDay;
  // Clamp to a real working day — collapsing the span (e.g. a resize dragged past the
  // opposite edge → 1-day span) would otherwise inflate hours/day without bound.
  return { hours: Math.max(0, Math.min(raw, MAX_HOURS_PER_DAY)), clamped: raw > MAX_HOURS_PER_DAY };
}

/** Resolve a gesture (move / resize) into the new date range and hours/day to commit.
 *  The dates come from applyGesture (weekend-aware via opts); in DAYS mode a resize
 *  rescales hours/day to hold the work volume constant, while a move — or an unchanged
 *  span (deltaDays === 0) — keeps the original hours. Mirrors the pointer-commit math so
 *  the source and reassign-target both go through one place. `clamped` reports whether a
 *  volume-preserving resize hit the 24h cap (truncating work volume), so the commit can
 *  surface it; it's false for a move and any non-rescaling path. */
export function resolveGesture(
  mode: DragMode,
  current: DateRange,
  deltaDays: number,
  options: GestureOptions,
  hoursPerDay: number,
  isDays: boolean,
): { dates: DateRange; hours: number; clamped: boolean } {
  // A zero-column move can still be a cross-row reassign. Run move math so the unchanged start is
  // reinterpreted against the target resource's working week; resize no-ops keep their reference.
  const dates =
    deltaDays !== 0 || mode === "move"
      ? applyGesture({ mode: mode, range: current, deltaDays: deltaDays, options: options })
      : current;
  if (isDays && mode !== "move" && deltaDays !== 0) {
    const { hours, clamped } = resolveVolumePreservingHours(current, dates, options, hoursPerDay);
    return { dates, hours, clamped };
  }
  return { dates, hours: hoursPerDay, clamped: false };
}

/** Pixel geometry for the live drag preview: snap the dates the SAME way the commit will
 *  (applyGesture), then run them through the SAME ColumnGeometry the view-model used to place
 *  bar.x / bar.width. Going through one geometry is what keeps the bar from jumping on release —
 *  even when the snapped range crosses a narrowed weekend, the preview is pixel-identical to the
 *  committed bar. Callers apply this only when deltaDays !== 0 (an unchanged drag keeps bar.x /
 *  bar.width). */
export function buildSnappedBarGeometry(
  mode: DragMode,
  current: DateRange,
  deltaDays: number,
  options: GestureOptions,
  geometry: ColumnGeometry,
): { left: number; width: number } {
  const snapped = applyGesture({ mode: mode, range: current, deltaDays: deltaDays, options: options });
  return {
    left: geometry.xForDateInGeom(snapped.startDate),
    width: geometry.widthForDates(snapped.startDate, snapped.endDate),
  };
}
