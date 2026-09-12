import { applyGesture, type DateRange, type DragMode } from "../../lib/gestureMath";
import type { Weekday } from "@capacitylens/shared/types/entities";
import type { BarLayout } from "./schedulerModel";
import type { ColumnGeometry } from "./columnGeometry";

interface BuildGesturePreviewDatesInput {
  bar: BarLayout;
  mode: DragMode;
  deltaDays: number;
  /** The lane the pointer is over: the week the previewed range is placed in, and the one the
   *  drop gate below judges. */
  previewDays: Weekday[] | undefined;
  /** The dragged bar's own week, passed only when the pointer is over a different lane. It sizes
   *  the previewed range so the preview matches what the commit will write. */
  sourceDays?: Weekday[] | undefined;
  /** Whether the pointer is over a different resource lane. This remains true if the source
   *  resource disappears and its working week can no longer be resolved. */
  isReassignment: boolean;
}

type GesturePreviewResult = { kind: "blocked" } | { kind: "unchanged" } | { kind: "ready"; dates: DateRange };

export function buildGesturePreviewDates({
  bar,
  mode,
  deltaDays,
  previewDays,
  sourceDays,
  isReassignment,
}: BuildGesturePreviewDatesInput): GesturePreviewResult {
  // Snap ONCE per frame, against the lane the pointer is actually over — the drop-target gate
  // below and the bar's own preview pixels then read the same range instead of each deriving it.
  // A zero-column resize moves nothing, so it keeps the view-model's placement (dates: null).
  // An empty memoized week ([]) is the collapsed "none" state: the commit below refuses the
  // gesture, so the preview shows no movement rather than calendar-day math the save rejects.
  if (previewDays?.length === 0 && !bar.allocation.ignoreWeekends) return { kind: "blocked" };
  // A zero-column gesture that is not also a reassignment commits nothing, so it must preview
  // nothing: re-deriving the range here would renormalise a bar whose stored dates predate a change
  // to its own resource's week, then snap it back on release.
  if (deltaDays === 0 && (mode !== "move" || !isReassignment)) return { kind: "unchanged" };
  return {
    kind: "ready",
    dates: applyGesture({
      mode: mode,
      range: { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate },
      deltaDays: deltaDays,
      options: {
        ...(previewDays !== undefined ? { workingDays: previewDays } : {}),
        ...(sourceDays !== undefined ? { sourceWorkingDays: sourceDays } : {}),
        ...(bar.allocation.ignoreWeekends !== undefined ? { ignoreWeekends: bar.allocation.ignoreWeekends } : {}),
      },
    }),
  };
}

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
    // The snapped range is already on the preview (see onPreview) — all that is left per frame is
    // running it through the SAME ColumnGeometry the view-model placed bar.x / bar.width with, so
    // the preview stays pixel-identical to the committed bar even across a narrowed weekend.
    // Any gesture that carries a settled range draws it, zero-column reassignments included: a
    // cross-row drop can change the range without moving a single column, and previewing the old
    // pixels would show a width the release is about to contradict.
    if (preview.dates) {
      left = geometry.xForDateInGeom(preview.dates.startDate);
      width = geometry.widthForDates(preview.dates.startDate, preview.dates.endDate);
    }
  }

  return { left, width, translateY };
}
