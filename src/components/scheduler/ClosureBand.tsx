import type { Closure, ISODate } from "@capacitylens/shared/types/entities";
import type { ColumnGeometry } from "./columnGeometry";
import { buildVisibleSpanInsets } from "./visibleSpanInsets";

/** The band is usually both wider and taller than the viewport, so its name is clamped to the
 *  visible portion on BOTH axes and centred there: it then stays on screen however far the
 *  schedule has been scrolled across a long closure or down a long list of people. */
const LABEL_INSETS_X = buildVisibleSpanInsets("x", "var(--band-left)", "var(--band-width)");
const LABEL_INSETS_Y = buildVisibleSpanInsets("y", "0px", "var(--band-height)");

export function ClosureBand({
  closure,
  visibleStart,
  visibleEnd,
  geom: geometry,
  leftOffset,
  height,
}: {
  closure: Closure;
  visibleStart: ISODate;
  visibleEnd: ISODate;
  geom: ColumnGeometry;
  leftOffset: number;
  height: number;
}) {
  const start = closure.startDate < visibleStart ? visibleStart : closure.startDate;
  const end = closure.endDate > visibleEnd ? visibleEnd : closure.endDate;
  const width = geometry.widthForDates(start, end);
  if (height <= 0 || width <= 0) return null;
  const timelineLeft = geometry.xForDateInGeom(start);

  return (
    <div
      data-testid="scheduler-closure-band"
      data-closure-id={closure.id}
      data-start-date={closure.startDate}
      data-end-date={closure.endDate}
      aria-hidden="true"
      className="scheduler-closure-band pointer-events-none absolute top-0 z-0 overflow-hidden border-x border-line text-2xs font-semibold uppercase tracking-wide text-foreground"
      style={{
        left: leftOffset + timelineLeft,
        width,
        height,
        // The clamp works in timeline coordinates, where the frozen resource column cancels out,
        // so publish the band's start WITHOUT the column offset its own `left` carries. The band
        // starts at the top of the rowgroup, which is where the vertical scroll offset is measured
        // from too, so its y start is a literal 0.
        ["--band-left" as string]: `${timelineLeft}px`,
        ["--band-width" as string]: `${width}px`,
        ["--band-height" as string]: `${height}px`,
        background:
          "repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-faint) 32%, transparent) 0 3px, color-mix(in oklab, var(--color-scheduler-canvas) 72%, transparent) 3px 9px)",
      }}
    >
      <div
        data-testid="scheduler-closure-label-box"
        className="absolute flex items-center justify-center overflow-hidden"
        style={{
          left: LABEL_INSETS_X.leading,
          right: LABEL_INSETS_X.trailing,
          top: LABEL_INSETS_Y.leading,
          bottom: LABEL_INSETS_Y.trailing,
        }}
      >
        {width > 44 ? (
          <span data-testid="scheduler-closure-label" className="truncate px-1 py-1">
            {closure.name}
          </span>
        ) : (
          <span data-testid="scheduler-closure-label" className="max-h-full truncate py-1 [writing-mode:vertical-rl]">
            {closure.name}
          </span>
        )}
      </div>
    </div>
  );
}
