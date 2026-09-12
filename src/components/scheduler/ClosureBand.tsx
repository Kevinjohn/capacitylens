import type { CSSProperties } from "react";
import type { Closure, ISODate } from "@capacitylens/shared/types/entities";
import type { ColumnGeometry } from "./columnGeometry";
import { buildVisibleSpanInsets } from "./visibleSpanInsets";

/** The band is usually both wider and taller than the viewport, so its name is clamped to the
 *  visible portion on BOTH axes and centred there: it then stays on screen however far the
 *  schedule has been scrolled across a long closure or down a long list of people. */
const LABEL_INSETS_X = buildVisibleSpanInsets("x", "var(--band-left)", "var(--band-width)");
const LABEL_INSETS_Y = buildVisibleSpanInsets("y", "0px", "var(--band-height)");

/** Wide enough to read the name across rather than sideways. */
const READABLE_ACROSS_WIDTH = 44;

function ClosureLabel({ name, width }: { name: string; width: number }) {
  return (
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
      {width > READABLE_ACROSS_WIDTH ? (
        <span data-testid="scheduler-closure-label" className="truncate px-1 py-1">
          {name}
        </span>
      ) : (
        <span data-testid="scheduler-closure-label" className="max-h-full truncate py-1 [writing-mode:vertical-rl]">
          {name}
        </span>
      )}
    </div>
  );
}

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

  // One geometry for both layers, so the name can never drift from the shading it belongs to.
  // The visible-portion clamp works in timeline coordinates, where the frozen resource column
  // cancels out, so the published start omits the column offset that `left` itself carries. Both
  // layers start at the top of the rowgroup, which is also where the vertical scroll offset is
  // measured from, so their y start is a literal 0.
  const geometryStyle: CSSProperties = {
    left: leftOffset + timelineLeft,
    width,
    height,
    ["--band-left" as string]: `${timelineLeft}px`,
    ["--band-width" as string]: `${width}px`,
    ["--band-height" as string]: `${height}px`,
  };

  return (
    <>
      <div
        data-testid="scheduler-closure-band"
        data-closure-id={closure.id}
        data-start-date={closure.startDate}
        data-end-date={closure.endDate}
        aria-hidden="true"
        className="scheduler-closure-band pointer-events-none absolute top-0 z-0 overflow-hidden border-x border-line"
        style={{
          ...geometryStyle,
          background:
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-faint) 32%, transparent) 0 3px, color-mix(in oklab, var(--color-scheduler-canvas) 72%, transparent) 3px 9px)",
        }}
      />
      {/* The name rides on its OWN layer rather than inside the band. The band's shading has to
          stay beneath the group-header rows (#766), and `z-0` makes it a stacking context, so a
          name nested in it would be buried by every group header it scrolled behind — the very
          "closure is unnamed" symptom #788 removes. A sibling layer can outrank those rows while
          the shading underneath stays exactly where #766 put it. */}
      <div
        data-testid="scheduler-closure-label-layer"
        data-closure-id={closure.id}
        aria-hidden="true"
        className="scheduler-closure-label-layer pointer-events-none absolute top-0 overflow-hidden text-2xs font-semibold uppercase tracking-wide text-foreground"
        style={{ ...geometryStyle, zIndex: "var(--z-index-scheduler-closure-label)" }}
      >
        <ClosureLabel name={closure.name} width={width} />
      </div>
    </>
  );
}
