import { applyGesture } from "@/lib/gestureMath";
import type { DateRange, DragMode } from "@/lib/gestureMath";
import type { Allocation, Weekday } from "@capacitylens/shared/types/entities";
import type { BarLayout } from "./schedulerModel";
import type { ColumnGeometry } from "./columnGeometry";

interface BuildGesturePreviewDatesInput {
  allocation: Pick<Allocation, "startDate" | "endDate" | "ignoreWeekends">;
  mode: DragMode;
  deltaDays: number;
  /** The lane the pointer is over: the week the previewed range is placed in, and the one the
   * drop gate below judges. */
  previewDays: Weekday[] | undefined;
  /** The dragged bar's own week, passed only when the pointer is over a different lane. It sizes
   * the previewed range so the preview matches what the commit will write. */
  sourceDays?: Weekday[] | undefined;
  /** Whether the pointer is over a different resource lane. This remains true if the source
   * resource disappears and its working week can no longer be resolved. */
  isReassignment: boolean;
}

type GesturePreviewResult = { kind: "blocked" } | { kind: "unchanged" } | { kind: "ready"; dates: DateRange };

/** Clamps a bar gesture to valid dates before previewing it. */
export function buildGesturePreviewDates({
  allocation,
  mode,
  deltaDays,
  previewDays,
  sourceDays,
  isReassignment,
}: BuildGesturePreviewDatesInput): GesturePreviewResult {
  // Resolve one preview range per frame so hit testing and painting use the same working-calendar snapshot. An empty week or no-op resize must not display a change that commit will refuse.
  if (previewDays?.length === 0 && !allocation.ignoreWeekends) return { kind: "blocked" };
  // A no-op gesture must keep stored dates so changed working calendars do not produce a preview that snaps back on release.
  if (deltaDays === 0 && (mode !== "move" || !isReassignment)) return { kind: "unchanged" };
  return {
    kind: "ready",
    dates: applyGesture({
      mode: mode,
      range: { startDate: allocation.startDate, endDate: allocation.endDate },
      deltaDays: deltaDays,
      options: {
        ...(previewDays !== undefined ? { workingDays: previewDays } : {}),
        ...(sourceDays !== undefined ? { sourceWorkingDays: sourceDays } : {}),
        ...(allocation.ignoreWeekends !== undefined ? { ignoreWeekends: allocation.ignoreWeekends } : {}),
      },
    }),
  };
}

/** Projects a bar gesture into visible column positions. */
export function buildGesturePreviewGeometry(
  bar: BarLayout,
  geometry: ColumnGeometry,
  preview: { mode: DragMode; deltaDays: number; deltaY: number; dates: DateRange | null } | null,
) {
  let left = bar.x;
  let width = bar.width;
  let translateY = 0;
  if (preview) {
    if (preview.mode === "move") translateY = preview.deltaY;
    // Measure the settled preview range through the shared geometry, including zero-column reassignments whose destination calendar changes the span.
    if (preview.dates) {
      left = geometry.xForDateInGeom(preview.dates.startDate);
      width = geometry.widthForDates(preview.dates.startDate, preview.dates.endDate);
    }
  }

  return { left, width, translateY };
}
