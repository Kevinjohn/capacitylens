import type { Closure, ISODate } from "@capacitylens/shared/types/entities";
import type { ColumnGeometry } from "./columnGeometry";

export function ClosureBand({
  closure,
  visibleStart,
  visibleEnd,
  geom,
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
  const width = geom.widthForDates(start, end);
  if (height <= 0 || width <= 0) return null;

  return (
    <div
      data-testid="scheduler-closure-band"
      data-closure-id={closure.id}
      data-start-date={closure.startDate}
      data-end-date={closure.endDate}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 flex items-start justify-center overflow-hidden border-x border-line text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
      style={{
        left: leftOffset + geom.xForDateInGeom(start),
        width,
        height,
        background:
          "repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-faint) 32%, transparent) 0 3px, color-mix(in oklab, var(--color-scheduler-canvas) 72%, transparent) 3px 9px)",
      }}
    >
      {width > 44 ? (
        <span className="truncate px-1 py-1">{closure.name}</span>
      ) : (
        <span className="max-h-full truncate py-1 [writing-mode:vertical-rl]">{closure.name}</span>
      )}
    </div>
  );
}
