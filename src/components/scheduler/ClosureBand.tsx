import type { CSSProperties } from "react";
import type { Closure, ISODate } from "@capacitylens/shared/types/entities";
import type { ColumnGeometry } from "./columnGeometry";
import { buildVisibleSpanInsets } from "./visibleSpanInsets";

// Clamp the closure label to the visible region on both axes so long spans remain identifiable while scrolling.
const LABEL_INSETS_X = buildVisibleSpanInsets("x", "var(--band-left)", "var(--band-width)");
const LABEL_INSETS_Y = buildVisibleSpanInsets("y", "0px", "var(--band-height)");

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

/** Marks a company closure across its scheduled dates. */
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

  // Both closure layers share one timeline-coordinate geometry so the label stays aligned with its shading. Exclude the frozen resource-column offset from the published clamp coordinate.
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
      {/* A sibling label layer can sit above group headers while the closure shading stays below them; nesting would trap the label in the band's z-0 stacking context. */}
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
