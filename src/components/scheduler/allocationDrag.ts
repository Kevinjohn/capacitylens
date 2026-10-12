import { applyGesture } from "@/lib/gestureMath";
import type { DateRange, DragMode, GestureOptions } from "@/lib/gestureMath";
import { resolveScheduledHoursOnDay } from "@/lib/capacity";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { spanDays } from "@capacitylens/shared/lib/schedulingDays";
import { FULL_DAY_HOURS, isExternalResource, MAX_HOURS_PER_DAY } from "@capacitylens/shared/types/entities";
import type { ISODate, Resource } from "@capacitylens/shared/types/entities";
import type { ColumnGeometry } from "./columnGeometry";

interface ReconcileReassignedHoursInput {
  current: number;
  target: Resource;
  zeroLoadMode: boolean;
  startDate: ISODate;
  effectiveWeek: EffectiveWorkingWeek;
}

interface ResolveVolumePreservingHoursInput {
  previousDate: DateRange;
  next: DateRange;
  options: GestureOptions;
  hoursPerDay: number;
}

interface ResolveGestureInput {
  mode: DragMode;
  current: DateRange;
  deltaDays: number;
  options: GestureOptions;
  hoursPerDay: number;
  isDays: boolean;
}

interface BuildSnappedBarGeometryInput {
  mode: DragMode;
  current: DateRange;
  deltaDays: number;
  options: GestureOptions;
  geometry: ColumnGeometry;
}

// Pure date, load and geometry policy belongs here; DOM hit testing and store commits remain at the gesture boundary. Unexpected computation errors must propagate rather than be swallowed.

/** Hours/day an allocation should carry after being reassigned (dragged) to `target`. An external
 * / 3rd party always carries no load (0). In Hours/Days mode, a zero-hour booking dragged off an
 * external is promoted to the target's working day because those forms require positive load.
 * Blocks mode deliberately permits and preserves zero; existing positive historical values are
 * also retained for a real→real reassign. A same-resource move never calls this. */
export function reconcileReassignedHours({
  current,
  target,
  zeroLoadMode,
  startDate,
  effectiveWeek,
}: ReconcileReassignedHoursInput): number {
  if (isExternalResource(target)) return 0;
  if (current > 0 || zeroLoadMode) return current;
  return resolveScheduledHoursOnDay(target, startDate, effectiveWeek) || FULL_DAY_HOURS;
}

/** Preserves days-mode work volume while resizing and reports when the hours cap truncates it. Unmeasurable source or destination spans preserve the stored hours without reporting a clamp. */
export function resolveVolumePreservingHours({
  previousDate,
  next,
  options,
  hoursPerDay,
}: ResolveVolumePreservingHoursInput): { hours: number; clamped: boolean } {
  const oldSpan = spanDays(previousDate.startDate, previousDate.endDate, options);
  const newSpan = spanDays(next.startDate, next.endDate, options);
  // A source span with no effective work duration must keep its stored hours so resizing cannot silently erase a booking.
  let raw = hoursPerDay;
  if (oldSpan !== 0 && newSpan > 0) raw = (hoursPerDay * oldSpan) / newSpan;
  // Cap derived daily load because shrinking a volume-preserving span can exceed a real day's limit.
  return { hours: Math.max(0, Math.min(raw, MAX_HOURS_PER_DAY)), clamped: raw > MAX_HOURS_PER_DAY };
}

/** Resolves a gesture into its dates and daily load. Moves preserve stored load; a non-zero days-mode resize preserves total volume and reports cap truncation. */
export function resolveGesture({ mode, current, deltaDays, options, hoursPerDay, isDays }: ResolveGestureInput): {
  dates: DateRange;
  hours: number;
  clamped: boolean;
} {
  // A zero-column move can still be a cross-row reassign. Run move math so the unchanged start is
  // reinterpreted against the target resource's working week; resize no-ops keep their reference.
  const dates =
    deltaDays !== 0 || mode === "move"
      ? applyGesture({ mode: mode, range: current, deltaDays: deltaDays, options: options })
      : current;
  if (isDays && mode !== "move" && deltaDays !== 0) {
    const { hours, clamped } = resolveVolumePreservingHours({
      previousDate: current,
      next: dates,
      options,
      hoursPerDay,
    });
    return { dates, hours, clamped };
  }
  return { dates, hours: hoursPerDay, clamped: false };
}

/** Snaps the range and measures it through the shared column geometry so preview pixels match committed placement, including narrowed weekends. */
export function buildSnappedBarGeometry({
  mode,
  current,
  deltaDays,
  options,
  geometry,
}: BuildSnappedBarGeometryInput): { left: number; width: number } {
  const snapped = applyGesture({ mode: mode, range: current, deltaDays: deltaDays, options: options });
  return {
    left: geometry.xForDateInGeom(snapped.startDate),
    width: geometry.widthForDates(snapped.startDate, snapped.endDate),
  };
}
