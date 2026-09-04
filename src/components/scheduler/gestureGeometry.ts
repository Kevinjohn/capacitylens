import { applyGesture, type DateRange, type DragMode } from "../../lib/gestureMath";
import type { Weekday } from "@capacitylens/shared/types/entities";
import type { BarLayout } from "./schedulerModel";
import type { ColumnGeometry } from "./columnGeometry";

export function gesturePreviewDates(
  bar: BarLayout,
  mode: DragMode,
  deltaDays: number,
  previewDays: Weekday[] | undefined,
) {
  // Snap ONCE per frame, against the lane the pointer is actually over — the drop-target gate
  // below and the bar's own preview pixels then read the same range instead of each deriving it.
  // A zero-column resize moves nothing, so it keeps the view-model's placement (dates: null).
  // An empty memoized week ([]) is the collapsed "none" state: the commit below refuses the
  // gesture, so the preview shows no movement rather than calendar-day math the save rejects.
  const previewImpossible = previewDays?.length === 0 && !bar.allocation.ignoreWeekends;
  const dates =
    !previewImpossible && (deltaDays !== 0 || mode === "move")
      ? applyGesture(mode, { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }, deltaDays, {
          workingDays: previewDays,
          ignoreWeekends: bar.allocation.ignoreWeekends,
        })
      : null;
  return { previewImpossible, dates };
}

export function gesturePreviewGeometry(
  bar: BarLayout,
  geom: ColumnGeometry,
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
    if (preview.deltaDays !== 0 && preview.dates) {
      left = geom.xForDateInGeom(preview.dates.startDate);
      width = geom.widthForDates(preview.dates.startDate, preview.dates.endDate);
    }
  }

  return { left, width, translateY };
}
