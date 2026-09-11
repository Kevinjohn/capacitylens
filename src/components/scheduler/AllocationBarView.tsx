import type {
  CSSProperties,
  FocusEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  PointerEventHandler,
} from "react";
import { Repeat2 } from "lucide-react";
import { m } from "@/i18n";
import { formatDayMonthEndpoint, formatDayMonthRange } from "../../lib/dateDisplay";
import { resolveAllocationStatusLabel } from "../../lib/metadata";
import { TooltipContent, TooltipRoot, TooltipTrigger } from "../ui/tooltip";
import { LAYOUT } from "./layout";
import type { BarLayout } from "./schedulerModel";

interface AllocationBarViewProps {
  bar: BarLayout;
  ariaLabel: string;
  background: string;
  ink: string;
  canEdit: boolean;
  cursor: CSSProperties["cursor"];
  dragging: boolean;
  hideHours: boolean;
  insetLeft: number;
  insetWidth: number;
  labelText: string;
  popoverFooter: string;
  popoverOpen: boolean;
  showSeriesIcon: boolean;
  showTaskFieldInSchedule: boolean;
  translateY: number;
  onBlur: FocusEventHandler<HTMLDivElement>;
  onFocus: FocusEventHandler<HTMLDivElement>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onMouseEnter: MouseEventHandler<HTMLDivElement>;
  onMouseLeave: MouseEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement> | undefined;
}

/** Keep the display rounding local so this view has no import cycle with its orchestrator. */
const roundDisplayHours = (hours: number) => Math.round(hours * 100) / 100;

const gripClass = "group/grip absolute inset-y-0 flex w-2.5 cursor-ew-resize items-center justify-center";
const gripLine = (
  <span
    aria-hidden
    className="pointer-events-none h-4 w-0.5 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-60"
  />
);

function BarContents({
  bar,
  canEdit,
  hideHours,
  labelText,
  showSeriesIcon,
}: Pick<AllocationBarViewProps, "bar" | "canEdit" | "hideHours" | "labelText" | "showSeriesIcon">) {
  return (
    <>
      {canEdit && (
        <span data-handle="start" data-testid="resize-start" className={`left-0 ${gripClass}`}>
          {gripLine}
        </span>
      )}
      {bar.allocation.status === "tentative" && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(45deg, color-mix(in oklab, currentColor 16%, transparent) 0 4px, transparent 4px 8px)",
          }}
        />
      )}
      <span className="flex min-w-0 items-center gap-1 px-2.5">
        {showSeriesIcon && <Repeat2 aria-hidden data-testid="allocation-series-icon" className="size-3 shrink-0" />}
        <span className="truncate">
          {bar.allocation.status === "completed" ? "✓ " : ""}
          {labelText}
          {hideHours ? "" : m.scheduler_bar_hours_suffix({ hours: roundDisplayHours(bar.allocation.hoursPerDay) })}
          {bar.allocation.note ? " •" : ""}
        </span>
      </span>
      {canEdit && (
        <span data-handle="end" data-testid="resize-end" className={`right-0 ${gripClass}`}>
          {gripLine}
        </span>
      )}
    </>
  );
}

function BarTrigger(props: AllocationBarViewProps) {
  const { bar, background, canEdit, dragging, ink, translateY } = props;
  return (
    <TooltipTrigger asChild>
      <div
        data-testid="allocation-bar"
        data-alloc-id={bar.allocation.id}
        data-status={bar.allocation.status}
        role={canEdit ? "button" : "img"}
        tabIndex={0}
        aria-label={props.ariaLabel}
        onPointerDown={props.onPointerDown}
        onMouseEnter={props.onMouseEnter}
        onMouseLeave={props.onMouseLeave}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onKeyDown={props.onKeyDown}
        className={`scheduler-bar group absolute flex select-none items-center overflow-hidden rounded-md text-xs font-medium shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md ${dragging ? "shadow-lg ring-black/10" : ""}`}
        style={{
          left: props.insetLeft,
          width: props.insetWidth,
          top: bar.top,
          height: LAYOUT.barHeight,
          backgroundColor: background,
          color: ink,
          border: bar.allocation.status === "tentative" ? `1px dashed ${ink}` : undefined,
          transform: translateY ? `translateY(${translateY}px)` : undefined,
          zIndex: dragging ? "var(--z-index-drag)" : undefined,
          // Reserve the measured sticky header and fixed utilisation column when focused.
          scrollMarginTop: "var(--sched-sticky-top, 44px)",
          scrollMarginLeft: LAYOUT.leftColWidth,
          cursor: props.cursor,
          touchAction: canEdit ? "none" : undefined,
        }}
      >
        <BarContents {...props} />
      </div>
    </TooltipTrigger>
  );
}

function BarPopover({
  background,
  bar,
  hideHours,
  popoverFooter,
  showTaskFieldInSchedule,
}: Pick<AllocationBarViewProps, "background" | "bar" | "hideHours" | "popoverFooter" | "showTaskFieldInSchedule">) {
  return (
    <TooltipContent
      side="bottom"
      align="start"
      sideOffset={6}
      showArrow={false}
      data-testid="allocation-popover"
      aria-hidden
      aria-label={popoverFooter}
      className="scheduler-alloc-popover pointer-events-none z-(--z-index-popover) w-60 rounded-lg p-3 font-normal"
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: background }}
        />
        <span className="font-semibold">{bar.label}</span>
      </div>
      {(Boolean(bar.project) || Boolean(bar.client)) && (
        <div className="mb-1 text-muted-foreground">
          {bar.project}
          {bar.project && bar.client ? " · " : ""}
          {bar.client}
        </div>
      )}
      <div className="text-muted-foreground">
        {formatDayMonthRange(bar.allocation.startDate, bar.allocation.endDate)}
        {hideHours ? "" : m.scheduler_bar_pop_hours({ hours: roundDisplayHours(bar.allocation.hoursPerDay) })} ·{" "}
        {resolveAllocationStatusLabel(bar.allocation.status)}
      </div>
      {bar.seriesEnd && (
        <div className="mt-1 text-muted-foreground">
          <Repeat2 aria-hidden className="mr-1 inline size-3" />
          {m.scheduler_bar_pop_series({ end: formatDayMonthEndpoint(bar.seriesEnd, bar.allocation.endDate) })}
        </div>
      )}
      {showTaskFieldInSchedule && bar.allocation.task && (
        <div className="mt-1 break-words border-t border-line pt-1 text-muted-foreground">{bar.allocation.task}</div>
      )}
      {bar.allocation.note && (
        <div className="mt-1 border-t border-line pt-1 text-muted-foreground">{bar.allocation.note}</div>
      )}
    </TooltipContent>
  );
}

export function AllocationBarView(props: AllocationBarViewProps) {
  return (
    // Fully controlled: pointerdown/click must not dismiss a viewer's popover. Escape is handled by
    // the trigger, outside Radix's combined close pipeline. The provider is shared by SchedulerGrid.
    <TooltipRoot open={props.popoverOpen && !props.dragging}>
      <BarTrigger {...props} />
      {/* Avoid re-evaluating formatting/i18n on each pointermove; Radix permits conditional Content. */}
      {props.popoverOpen && !props.dragging && <BarPopover {...props} />}
    </TooltipRoot>
  );
}
