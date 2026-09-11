import type { Closure, ISODate } from "@capacitylens/shared/types/entities";
import type { ColumnGeometry } from "./columnGeometry";

export function ClosureBand({
  closure,
  visibleStart,
  visibleEnd,
  geom: geometry,
  leftOffset,
  height,
  labelTop,
}: {
  closure: Closure;
  visibleStart: ISODate;
  visibleEnd: ISODate;
  geom: ColumnGeometry;
  leftOffset: number;
  height: number;
  labelTop: number;
}) {
  const start = closure.startDate < visibleStart ? visibleStart : closure.startDate;
  const end = closure.endDate > visibleEnd ? visibleEnd : closure.endDate;
  const width = geometry.widthForDates(start, end);
  if (height <= 0 || width <= 0) return null;

  return (
    <div
      data-testid="scheduler-closure-band"
      data-closure-id={closure.id}
      data-start-date={closure.startDate}
      data-end-date={closure.endDate}
      aria-hidden="true"
      className="scheduler-closure-band pointer-events-none absolute top-0 z-0 flex items-start justify-center overflow-hidden border-x border-line text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
      style={{
        left: leftOffset + geometry.xForDateInGeom(start),
        width,
        height,
        background:
          "repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-faint) 32%, transparent) 0 3px, color-mix(in oklab, var(--color-scheduler-canvas) 72%, transparent) 3px 9px)",
      }}
    >
      {width > 44 ? (
        <span data-testid="scheduler-closure-label" className="truncate px-1 py-1" style={{ marginTop: labelTop }}>
          {closure.name}
        </span>
      ) : (
        <span
          data-testid="scheduler-closure-label"
          className="max-h-full truncate py-1 [writing-mode:vertical-rl]"
          style={{ marginTop: labelTop }}
        >
          {closure.name}
        </span>
      )}
    </div>
  );
}
