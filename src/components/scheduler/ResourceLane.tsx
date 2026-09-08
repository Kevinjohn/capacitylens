import { memo } from "react";
import { Plus } from "lucide-react";
import type { ID, ISODate } from "@capacitylens/shared/types/entities";
import { useStore } from "../../store/useStore";
import { AllocationBar } from "./AllocationBar";
import type { ColumnGeometry } from "./columnGeometry";
import { LAYOUT } from "./layout";
import type { BarLayout, DayState, TimeOffBlock } from "./schedulerModel";
import { useResourceLaneInteraction } from "./useResourceLaneInteraction";

export interface ResourceLaneProps {
  resourceId: ID;
  ariaLabel: string;
  days: ISODate[];
  dayStates: DayState[];
  timeOff: TimeOffBlock[];
  todayX: number | null;
  geom: ColumnGeometry;
  rowHeight: number;
  barTop: number;
  bars: BarLayout[];
  placeholder?: boolean;
  weekStartsOn: 0 | 1;
  onEdit?: (allocationId: ID) => void;
  onDraw?: (resourceId: ID, startDate: ISODate, endDate: ISODate) => void;
}
interface LayersProps extends Omit<ResourceLaneProps, "ariaLabel" | "geom" | "resourceId" | "rowHeight"> {
  geometry: ColumnGeometry;
  draw: { a: number; b: number } | null;
  hoverDay: number | null;
  indexAt: (x: number) => number;
}

const BarsLayer = memo(function BarsLayer({
  bars,
  geometry,
  indexAt,
  onEdit,
}: Pick<LayersProps, "bars" | "geometry" | "indexAt" | "onEdit">) {
  const inert = useStore((state) => state.ui.drawMode === "timeoff");
  return (
    <div className="absolute inset-0" inert={inert || undefined}>
      {bars.map((bar) => (
        <AllocationBar
          key={bar.allocation.id}
          bar={bar}
          geom={geometry}
          indexAtClientX={indexAt}
          {...(onEdit ? { onEdit } : {})}
        />
      ))}
    </div>
  );
});

function CalendarLayers({ days, dayStates, geometry, placeholder, weekStartsOn }: LayersProps) {
  return (
    <>
      {placeholder && <div aria-hidden className="hatch-lines pointer-events-none absolute inset-0" />}
      {days.map((day, index) => {
        if (index === 0) return null;
        const weekStart = geometry.weekdays[index] === weekStartsOn;
        if (!weekStart && !geometry.perDayColumns) return null;
        return (
          <div
            key={`w-${day}`}
            className={`absolute top-0 h-full border-l ${weekStart ? "border-line" : "border-line-faint"}`}
            style={{ left: geometry.x(index) }}
          />
        );
      })}
      {geometry.perDayColumns &&
        days.map((day, index) =>
          dayStates[index]?.unavailable ? (
            <div
              key={`u-${day}`}
              data-testid="unavailable-day"
              data-date={day}
              className="absolute top-0 h-full bg-weekend"
              style={{ left: geometry.x(index), width: geometry.widthOf(index) }}
            />
          ) : null,
        )}
      {geometry.perDayColumns &&
        days.map((day, index) =>
          dayStates[index]?.partialCapacity ? (
            <div
              key={`h-${day}`}
              aria-hidden
              data-testid="half-day"
              data-date={day}
              className="pointer-events-none absolute bottom-0 h-1/2 bg-weekend"
              style={{ left: geometry.x(index), width: geometry.widthOf(index) }}
            />
          ) : null,
        )}
    </>
  );
}

function ScheduleSignals({ days, dayStates, geometry, timeOff }: LayersProps) {
  return (
    <>
      {timeOff.map((entry) => (
        <div
          key={entry.id}
          data-testid="timeoff-block"
          className="scheduler-timeoff-block pointer-events-none absolute inset-y-1 flex items-center justify-center overflow-hidden rounded text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
          style={{
            left: entry.x,
            width: entry.width,
            background:
              "repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-faint) 28%, transparent) 0 5px, transparent 5px 10px)",
          }}
        >
          <span className="sr-only">{entry.label}</span>
          <span aria-hidden>{entry.width > 44 ? entry.label : ""}</span>
        </div>
      ))}
      {days.map((day, index) => {
        const state = dayStates[index];
        if (!state?.over && !state?.timeOffConflict) return null;
        return (
          <div
            key={`o-${day}`}
            data-testid="over-marker"
            data-date={day}
            className={`pointer-events-none absolute top-0 h-full border-t-[3px] border-danger ${state.hasTimeOff ? "bg-danger/55" : "bg-danger-cell"}`}
            style={{ left: geometry.x(index), width: geometry.widthOf(index) }}
          />
        );
      })}
    </>
  );
}

function GestureLayers({ barTop, draw, geometry, hoverDay, onDraw }: LayersProps) {
  return (
    <>
      {onDraw && hoverDay !== null && !draw && geometry.perDayColumns && (
        <div
          aria-hidden
          data-testid="day-add-hint"
          className="pointer-events-none absolute top-0 flex h-full items-center justify-center text-faint/50"
          style={{ left: geometry.x(hoverDay), width: geometry.widthOf(hoverDay) }}
        >
          <Plus />
        </div>
      )}
      {draw && (
        <div
          className="pointer-events-none absolute rounded border-2 border-brand bg-brand/20"
          style={{
            left: geometry.x(Math.min(draw.a, draw.b)),
            width: geometry.spanWidth(Math.min(draw.a, draw.b), Math.max(draw.a, draw.b)),
            top: barTop,
            height: LAYOUT.barHeight,
          }}
        />
      )}
    </>
  );
}

function ResourceLaneLayers(props: LayersProps) {
  return (
    <>
      <CalendarLayers {...props} />
      <ScheduleSignals {...props} />
      <GestureLayers {...props} />
      <BarsLayer {...props} />
      {props.todayX !== null && (
        <div
          data-testid="today-line"
          className="pointer-events-none absolute inset-y-0 z-[2] w-0.5 bg-brand"
          style={{ left: props.todayX }}
        />
      )}
    </>
  );
}

export const ResourceLane = memo(function ResourceLane({
  geom: geometry,
  placeholder = false,
  ...props
}: ResourceLaneProps) {
  const { laneRef, draw, hoverDay, indexAt, onPointerDown, onPointerMove, onPointerUpCapture, setHoverDay } =
    useResourceLaneInteraction({
      resourceId: props.resourceId,
      days: props.days,
      dayStates: props.dayStates,
      geometry,
      ...(props.onDraw ? { onDraw: props.onDraw } : {}),
    });
  const layers = {
    ...props,
    geometry,
    placeholder,
    draw,
    hoverDay,
    indexAt,
  };
  return (
    <div
      ref={laneRef}
      data-testid="resource-lane"
      data-resource-id={props.resourceId}
      role="gridcell"
      aria-colindex={2}
      aria-label={props.ariaLabel}
      className="relative shrink-0 transition-colors"
      style={{ width: geometry.totalWidth, height: props.rowHeight }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUpCapture={onPointerUpCapture}
      onPointerLeave={() => setHoverDay(null)}
    >
      <ResourceLaneLayers {...layers} />
    </div>
  );
});
