import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { Eye, Plus } from "lucide-react";
import { m } from "@/i18n";
import { formatUtilizationPercent } from "../../lib/formatUtilizationPercent";
import { UTILIZATION_WINDOW_DAYS } from "../../lib/schedulerConfig";
import { Avatar } from "../common/ui";
import { resolveResourceDisplayName } from "../../lib/metadata";
import { LAYOUT, buildSchedulerDensity } from "./layout";
import { ResourceLane } from "./ResourceLane";
import { buildRowScreenReaderSummary } from "./buildRowScreenReaderSummary";
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
  density: ReturnType<typeof buildSchedulerDensity>;
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
  personScheduleTitlesByResourceId: ReadonlyMap<string, string>;
  onViewSchedule: (resourceId: string, opener: HTMLButtonElement) => void;
}

function ResourceIdentity({
  group,
  row,
  density,
  personScheduleTitlesByResourceId,
  onViewSchedule,
}: Pick<SchedulerGridRowProps, "group" | "row" | "density" | "personScheduleTitlesByResourceId" | "onViewSchedule">) {
  const { resource } = row;
  const scheduleTitle = personScheduleTitlesByResourceId.get(resource.id) ?? resolveResourceDisplayName(resource);
  const triggerLabel = m.scheduler_person_schedule_trigger({ name: scheduleTitle });
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" style={{ height: density.identityBandHeight }}>
      <Avatar
        name={resource.name ?? resource.role}
        color={group.color ?? resource.color}
        placeholder={resource.kind === "placeholder"}
      />
      <div className="ms-1.5 min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate text-sm font-medium">{resolveResourceDisplayName(resource)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-testid="person-schedule-trigger"
            aria-label={triggerLabel}
            title={triggerLabel}
            className="shrink-0 text-muted-foreground"
            onClick={(event) => onViewSchedule(resource.id, event.currentTarget)}
          >
            <Eye aria-hidden />
          </Button>
        </div>
        <span className="block truncate text-xs text-muted-foreground">{resource.role}</span>
      </div>
    </div>
  );
}

function UtilizationCell({
  utilization,
  overSoon,
  visibleWeeksLabel,
}: Pick<RowModel, "utilization" | "overSoon"> & { visibleWeeksLabel: string }) {
  const title = overSoon
    ? m.scheduler_util_title_oversoon({ days: UTILIZATION_WINDOW_DAYS, span: visibleWeeksLabel })
    : m.scheduler_util_title({ span: visibleWeeksLabel });
  return (
    <span
      data-testid="utilization"
      title={title}
      className={`flex w-11 flex-1 items-center justify-center border-t border-line text-2xs ${
        overSoon ? "font-semibold text-danger" : "text-faint"
      }`}
    >
      {formatUtilizationPercent(utilization)}%
    </span>
  );
}

function ResourceActions({
  row,
  ui,
  canEdit,
  visibleStartDate,
  setModal,
  utilizationPrefs,
  visibleWeeksLabel,
}: Pick<
  SchedulerGridRowProps,
  "row" | "ui" | "canEdit" | "visibleStartDate" | "setModal" | "utilizationPrefs" | "visibleWeeksLabel"
>) {
  const { resource, utilization, overSoon } = row;
  const canCreate = canEdit && (ui.drawMode !== "timeoff" || !isExternalResource(resource));
  const showUtilization = utilizationPrefs.showPersonal && isCapacityTracked(resource);
  return (
    <div className="flex shrink-0 flex-col self-stretch overflow-hidden border-s border-line text-center leading-none">
      {canCreate && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            const day = visibleStartDate();
            setModal({
              kind: ui.drawMode === "timeoff" ? "timeoff" : "create",
              resourceId: resource.id,
              startDate: day,
              endDate: day,
            });
          }}
          aria-label={
            ui.drawMode === "timeoff"
              ? m.scheduler_add_timeoff_for({ name: resolveResourceDisplayName(resource) })
              : m.scheduler_add_allocation_for({ name: resolveResourceDisplayName(resource) })
          }
          title={ui.drawMode === "timeoff" ? m.scheduler_add_timeoff() : m.scheduler_add_allocation()}
          className="h-auto w-11 flex-1 rounded-none text-muted-foreground"
        >
          <Plus />
        </Button>
      )}
      {showUtilization && (
        <UtilizationCell utilization={utilization} overSoon={overSoon} visibleWeeksLabel={visibleWeeksLabel} />
      )}
    </div>
  );
}

type RowHeaderProps = Pick<
  SchedulerGridRowProps,
  | "group"
  | "row"
  | "density"
  | "utilizationPrefs"
  | "visibleWeeksLabel"
  | "ui"
  | "canEdit"
  | "visibleStartDate"
  | "setModal"
  | "personScheduleTitlesByResourceId"
  | "onViewSchedule"
>;

function SchedulerGridRowHeader(props: RowHeaderProps) {
  const { row, group, density, utilizationPrefs, visibleWeeksLabel, ui } = props;
  const { resource } = row;
  return (
    <div
      role="rowheader"
      aria-colindex={1}
      className={`sticky left-0 z-10 flex shrink-0 items-start gap-2 border-r border-line bg-scheduler-canvas ps-3 ${
        resource.kind === "placeholder" ? "hatch-lines" : ""
      }`}
      style={{ width: LAYOUT.leftColWidth }}
    >
      <span className="sr-only">
        {buildRowScreenReaderSummary(row, {
          showPersonalUtilization: utilizationPrefs.showPersonal,
          visibleSpanLabel: visibleWeeksLabel,
          drawMode: ui.drawMode,
        })}
      </span>
      <ResourceIdentity
        group={group}
        row={row}
        density={density}
        personScheduleTitlesByResourceId={props.personScheduleTitlesByResourceId}
        onViewSchedule={props.onViewSchedule}
      />
      <ResourceActions {...props} />
    </div>
  );
}

export function SchedulerGridRow(props: SchedulerGridRowProps) {
  const { row, rowIndex, density, canEdit, days, todayX, geom, calendarWeekStartsOn, handleEdit, handleDraw } = props;
  const { resource, rowHeight, bars, dayStates, timeOff, dimmed } = row;
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
      <SchedulerGridRowHeader
        group={props.group}
        row={row}
        density={density}
        utilizationPrefs={props.utilizationPrefs}
        visibleWeeksLabel={props.visibleWeeksLabel}
        ui={props.ui}
        canEdit={canEdit}
        visibleStartDate={props.visibleStartDate}
        setModal={props.setModal}
        personScheduleTitlesByResourceId={props.personScheduleTitlesByResourceId}
        onViewSchedule={props.onViewSchedule}
      />

      <ResourceLane
        resourceId={resource.id}
        // Accessible name for the lane's role="gridcell" (col 2): the timeline cell was
        // previously unnamed. "<name> timeline" names it without duplicating the rowheader's
        // sr-only capacity summary, so the cell reads honestly in the column structure (WCAG 1.3.1).
        ariaLabel={m.scheduler_lane_aria({
          name: resolveResourceDisplayName(resource),
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
        {...(canEdit && handleEdit ? { onEdit: handleEdit } : {})}
        {...(canEdit && handleDraw ? { onDraw: handleDraw } : {})}
      />
    </div>
  );
}
