import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { Plus } from "lucide-react";
import { m } from "@/i18n";
import { formatUtilizationPercent } from "../../lib/utilizationPercent";
import { UTILIZATION_WINDOW_DAYS } from "../../lib/schedulerConfig";
import { Avatar } from "../common/ui";
import { resourceDisplayName } from "../../lib/metadata";
import { LAYOUT, schedulerDensity } from "./layout";
import { ResourceLane } from "./ResourceLane";
import { rowScreenReaderSummary } from "./rowSummary";
import type { GroupModel, RowModel } from "./schedulerModel";
import { isCapacityTracked, isExternalResource } from "@capacitylens/shared/types/entities";
import type { ISODate } from "@capacitylens/shared/types/entities";
import { Button } from "../ui/button";
import type { ModalState } from "./schedulerGridModal";
import type { SchedulerUI, StoreState } from "../../store/useStore";

type LaneProps = ComponentProps<typeof ResourceLane>;
export interface SchedulerGridRowProps {
  group: GroupModel;
  row: RowModel;
  rowIndex: number;
  density: ReturnType<typeof schedulerDensity>;
  utilizationPrefs: StoreState["utilizationPrefs"];
  visibleWeeksLabel: string;
  ui: Pick<SchedulerUI, "drawMode">;
  canEdit: boolean;
  visibleStartDate: () => ISODate;
  setModal: Dispatch<SetStateAction<ModalState | null>>;
  days: LaneProps["days"];
  todayX: LaneProps["todayX"];
  geom: LaneProps["geom"];
  calendarWeekStartsOn: LaneProps["weekStartsOn"];
  handleEdit: LaneProps["onEdit"];
  handleDraw: LaneProps["onDraw"];
}

export function SchedulerGridRow({
  group,
  row,
  rowIndex,
  density,
  utilizationPrefs,
  visibleWeeksLabel,
  ui,
  canEdit,
  visibleStartDate,
  setModal,
  days,
  todayX,
  geom,
  calendarWeekStartsOn,
  handleEdit,
  handleDraw,
}: SchedulerGridRowProps) {
  const { resource, rowHeight, bars, dayStates, timeOff, utilization: util, overSoon, dimmed } = row;
  return (
    /* One scheduler-row surface on the whole row (not just the sticky header) keeps the divider
         on ONE background — without it the border crosses the frozen left column
         and the darker timeline, reading as a two-tone line. */
    <div
      role="row"
      aria-rowindex={rowIndex}
      data-testid="scheduler-row"
      data-dimmed={dimmed || undefined}
      title={dimmed ? m.scheduler_row_dimmed_title() : undefined}
      className={`flex border-b border-line-soft bg-scheduler-canvas ${dimmed ? "opacity-45" : ""}`}
      style={{ height: rowHeight }}
    >
      <div
        role="rowheader"
        aria-colindex={1}
        className={`sticky left-0 z-10 flex shrink-0 items-start gap-2 border-r border-line bg-scheduler-canvas ps-3 ${
          resource.kind === "placeholder" ? "hatch-lines" : ""
        }`}
        style={{ width: LAYOUT.leftColWidth }}
      >
        {/* Text equivalent of the colour-only capacity cues (over-marker red background, time-off
              tint and half-day tint) — assembled in rowSummary.ts so the wording is unit-testable. */}
        <span className="sr-only">
          {rowScreenReaderSummary(row, {
            showPersonalUtilization: utilizationPrefs.showPersonal,
            visibleSpanLabel: visibleWeeksLabel,
            drawMode: ui.drawMode,
          })}
        </span>
        {/* Avatar + identity, vertically centred within the FIRST lane band
              (rowPadding + barHeight + rowPadding = a single-lane row height) and pinned to
              the top of the row. So a one-lane row keeps its balanced top/bottom padding
              (the band IS the whole row), while a taller multi-allocation row keeps the name
              aligned with the first bar instead of drifting to the row's centre as it grows.
              The "+/%" box stays self-stretch (full height); only this block is banded. */}
        <div className="flex min-w-0 flex-1 items-center gap-2" style={{ height: density.identityBandHeight }}>
          {/* Avatar fill follows the DISCIPLINE colour (group.color), so everyone in a
                discipline reads as one colour; synthetic engagement/unassigned groups fall
                back to each resource's own colour. */}
          <Avatar
            name={resource.name ?? resource.role}
            color={group.color ?? resource.color}
            placeholder={resource.kind === "placeholder"}
          />
          {/* ms-1.5: a little extra breathing room between the avatar and the text. */}
          <div className="ms-1.5 min-w-0 flex-1">
            <span className="flex items-center gap-1 truncate text-sm font-medium">
              {/* A placeholder ("slot") reads as the literal word "Placeholder" — an as-yet-unfilled
                    slot — with its role/discipline shown as secondary text below. */}
              {resourceDisplayName(resource)}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{resource.role}</span>
          </div>
        </div>
        {/* Right column: the add button and (optionally) the allocation %, stacked.
              The box always fills the full row height (self-stretch), and each cell takes
              an equal share (flex-1) — so the + alone fills the box, or the +/% split it
              50/50, and both grow with the row when allocations stack. Only the start
              border is drawn: the row's border-b and the panel's border-r close the box
              off, so there's no doubled hairline against those dividers. */}
        <div className="flex shrink-0 flex-col self-stretch overflow-hidden border-s border-line text-center leading-none">
          {/* Viewer (P1.12): no per-row create affordance. Hidden, not disabled — a viewer schedule
                is display-only. The utilisation % below still renders (a read, not an edit). */}
          {canEdit && (ui.drawMode !== "timeoff" || !isExternalResource(resource)) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                const d = visibleStartDate();
                setModal({
                  kind: ui.drawMode === "timeoff" ? "timeoff" : "create",
                  resourceId: resource.id,
                  startDate: d,
                  endDate: d,
                });
              }}
              aria-label={
                ui.drawMode === "timeoff"
                  ? m.scheduler_add_timeoff_for({ name: resourceDisplayName(resource) })
                  : m.scheduler_add_allocation_for({ name: resourceDisplayName(resource) })
              }
              title={ui.drawMode === "timeoff" ? m.scheduler_add_timeoff() : m.scheduler_add_allocation()}
              className="h-auto w-11 flex-1 rounded-none text-muted-foreground"
            >
              <Plus />
            </Button>
          )}
          {utilizationPrefs.showPersonal && isCapacityTracked(resource) && (
            <span
              data-testid="utilization"
              title={
                // The % itself is over the VISIBLE range; the overSoon red flag is the separate
                // fixed-window "over soon" warning (next UTILIZATION_WINDOW_DAYS days).
                overSoon
                  ? m.scheduler_util_title_oversoon({
                      days: UTILIZATION_WINDOW_DAYS,
                      span: visibleWeeksLabel,
                    })
                  : m.scheduler_util_title({ span: visibleWeeksLabel })
              }
              className={`flex w-11 flex-1 items-center justify-center border-t border-line text-2xs ${
                overSoon ? "font-semibold text-danger" : "text-faint"
              }`}
            >
              {formatUtilizationPercent(util)}%
            </span>
          )}
        </div>
      </div>

      <ResourceLane
        resourceId={resource.id}
        // Accessible name for the lane's role="gridcell" (col 2): the timeline cell was
        // previously unnamed. "<name> timeline" names it without duplicating the rowheader's
        // sr-only capacity summary, so the cell reads honestly in the column structure (WCAG 1.3.1).
        ariaLabel={m.scheduler_lane_aria({
          name: resourceDisplayName(resource),
        })}
        days={days}
        dayStates={dayStates}
        timeOff={timeOff}
        todayX={todayX}
        geom={geom}
        rowHeight={rowHeight}
        barTop={density.rowPadding}
        bars={bars}
        placeholder={resource.kind === "placeholder"}
        weekStartsOn={calendarWeekStartsOn}
        // Viewer (P1.12): pass NO edit/draw callbacks — the lane then bails its draw gesture and
        // drops the hover "+" hint (display-only). Editable (null/owner/admin/editor, incl.
        // OFF/local) gets the stable memoised callbacks, byte-identical to today.
        onEdit={canEdit ? handleEdit : undefined}
        onDraw={canEdit ? handleDraw : undefined}
      />
    </div>
  );
}
