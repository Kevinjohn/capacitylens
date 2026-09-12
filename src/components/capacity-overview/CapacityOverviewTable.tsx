import { isPlaceholderResource } from "@capacitylens/shared/types/entities";
import type { AppData, ID } from "@capacitylens/shared/types/entities";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import type { RefObject } from "react";
import { m } from "@/i18n";
import { formatWeekColumnRange } from "@/lib/dateDisplay";
import { resolveResourceDisplayName } from "@/lib/metadata";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useSchedulerDensity } from "../scheduler/layout";
import { PersonScheduleSheet } from "../person-schedule/PersonScheduleSheet";
import { PersonScheduleTrigger } from "../person-schedule/PersonScheduleTrigger";
import { usePersonScheduleDrawer } from "../person-schedule/usePersonScheduleDrawer";
import { capacityBarFillStyle, computeCapacityBarFill, formatWeekValueText } from "./capacityOverviewBar";
import type { CapacityBarFill, CapacityBarFillContext, CapacityDisplayMode } from "./capacityOverviewBar";
import type {
  CapacityOverviewGroup,
  CapacityOverviewModel,
  CapacityOverviewSummaryWeek,
  CapacityOverviewWeekResult,
} from "./capacityOverviewModel";
import { OverviewToolbar } from "./OverviewToolbar";

interface CapacityOverviewTableProps {
  model: CapacityOverviewModel;
  includeTentative: boolean;
  hasAvailability: boolean;
  showTotals: boolean;
  capacityDisplayMode: CapacityDisplayMode;
  onIncludeTentativeChange: (checked: boolean) => void;
  onHasAvailabilityChange: (checked: boolean) => void;
  onShowTotalsChange: (checked: boolean) => void;
  onCapacityDisplayModeChange: (mode: CapacityDisplayMode) => void;
}

interface PersonScheduleTriggerHandlers {
  personScheduleTitlesByResourceId: ReadonlyMap<string, string>;
  onViewSchedule: (resourceId: ID, opener: HTMLButtonElement) => void;
}

function formatDays(days: number, kind: "capacity" | "overbooked" | "unassigned") {
  if (kind === "capacity") return m.capacity_overview_days({ days: String(days) });
  if (kind === "overbooked") return m.capacity_overview_days_overbooked({ days: String(days) });
  return m.capacity_overview_days_unassigned({ days: String(days) });
}

function EmptyCapacity() {
  return <span className="text-muted-foreground">—</span>;
}

function WeekValues({
  result,
  capacityDisplayMode,
}: {
  result: CapacityOverviewWeekResult;
  capacityDisplayMode: CapacityDisplayMode;
}) {
  if (result.state === "unassigned") {
    return result.unassignedDemandDays > 0 ? (
      <span>{formatDays(result.unassignedDemandDays, "unassigned")}</span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }
  const showNumber = capacityDisplayMode !== "bar";
  if (!showNumber) {
    return <span className="sr-only">{formatWeekValueText(result, formatDays, "—")}</span>;
  }
  // "bar-number" paints this text on the `--color-danger-soft` fill (see capacityOverviewBar.ts):
  // the overbooked label switches to `text-danger-soft-ink`, the ink that fill is paired with, so
  // it clears AA there. Plain "number" mode has no coloured fill, so `text-destructive` still reads
  // correctly against the ordinary cell background.
  const overLabelInkClass = capacityDisplayMode === "bar-number" ? "text-danger-soft-ink" : "text-destructive";
  return (
    <div className="flex flex-col gap-0.5">
      {result.state === "available" ? (
        <span className="font-medium">{formatDays(result.freeDays, "capacity")}</span>
      ) : (
        <EmptyCapacity />
      )}
      {result.overDays > 0 && (
        <span className={`text-xs ${overLabelInkClass}`}>{formatDays(result.overDays, "overbooked")}</span>
      )}
    </div>
  );
}

function SummaryValues({ result, peopleCount }: { result: CapacityOverviewSummaryWeek; peopleCount: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      {peopleCount > 0 &&
        (result.freeDays > 0 ? (
          <span className="font-semibold">{formatDays(result.freeDays, "capacity")}</span>
        ) : (
          <EmptyCapacity />
        ))}
      {result.overDays > 0 && <span className="text-destructive">{formatDays(result.overDays, "overbooked")}</span>}
      {result.unassignedDemandDays > 0 && <span>{formatDays(result.unassignedDemandDays, "unassigned")}</span>}
      {peopleCount === 0 && result.unassignedDemandDays === 0 && <span className="text-muted-foreground">—</span>}
    </div>
  );
}

function GroupHeader({
  group,
  collapsed,
  onToggle,
  height,
  showTotals,
}: {
  group: CapacityOverviewGroup;
  collapsed: boolean;
  onToggle: () => void;
  height: number;
  showTotals: boolean;
}) {
  return (
    <TableRow
      data-testid="capacity-overview-group"
      className="bg-scheduler-group hover:bg-scheduler-group"
      style={{ height }}
    >
      {/* `scope="row"`: with totals hidden the week cells in this row are empty, and a scope-less
          `th` beside empty cells is treated as a column header by the accessibility tree, so the
          group name would be announced as a column heading. It is a row header either way. */}
      <TableHead scope="row" className="h-auto p-0">
        <Button
          variant="ghost"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="h-full w-full justify-start rounded-none px-3 text-xs font-semibold uppercase tracking-wide"
        >
          {collapsed ? <ChevronRight data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
          <span
            className="inline-block size-2.5 rounded-full ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: group.color ?? "var(--color-faint)" }}
          />
          <span className="truncate text-ink">{group.title}</span>
        </Button>
      </TableHead>
      {group.summary.weeks.map((result, index) => (
        <TableCell key={index} className="text-center text-xs">
          {!collapsed && showTotals && <SummaryValues result={result} peopleCount={group.summary.peopleCount} />}
        </TableCell>
      ))}
    </TableRow>
  );
}

function PersonIdentity({
  group,
  row,
  personScheduleTitlesByResourceId,
  onViewSchedule,
}: {
  group: CapacityOverviewGroup;
  row: CapacityOverviewGroup["rows"][number];
} & PersonScheduleTriggerHandlers) {
  const { resource } = row;
  const scheduleTitle = personScheduleTitlesByResourceId.get(resource.id) ?? resolveResourceDisplayName(resource);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <PersonScheduleTrigger
        resourceId={resource.id}
        scheduleTitle={scheduleTitle}
        avatarName={resource.name ?? resource.role}
        color={group.color ?? resource.color}
        placeholder={isPlaceholderResource(resource)}
        onViewSchedule={onViewSchedule}
      />
      <div className="ms-1.5 min-w-0">
        <span className="block truncate text-sm font-medium">{resolveResourceDisplayName(resource)}</span>
        <span className="block truncate text-xs text-muted-foreground">{resource.role}</span>
      </div>
    </div>
  );
}

// The fill paints as absolutely-positioned layers behind the cell's own text (kept in a `relative
// z-10` wrapper) rather than as a single `background` on the <td>, so the overbooked hatch can be
// confined to exactly the filled sub-region (its own div, sized to `fraction * 100%`) without
// distorting the pattern or bleeding into the grey portion above it.
function CapacityBarFillLayer({ fill, context }: { fill: CapacityBarFill; context: CapacityBarFillContext }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--color-faint)" }}
      />
      {fill.kind !== "none" && (
        <div
          aria-hidden="true"
          data-testid="capacity-bar-fill"
          data-bar-kind={fill.kind}
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{ height: `${fill.fraction * 100}%`, ...capacityBarFillStyle(fill, context) }}
        />
      )}
    </>
  );
}

function WeekValuesCell({
  result,
  capacityDisplayMode,
}: {
  result: CapacityOverviewWeekResult;
  capacityDisplayMode: CapacityDisplayMode;
}) {
  const showBar = capacityDisplayMode !== "number" && result.state !== "unassigned";
  return (
    <TableCell key={result.week.key} className="relative whitespace-normal px-2 text-center">
      {showBar && (
        <CapacityBarFillLayer
          fill={computeCapacityBarFill({
            companyWorkingHours: result.companyWorkingHours,
            freeHours: result.freeHours,
            overHours: result.overHours,
          })}
          // capacityDisplayMode is "bar" or "bar-number" here (showBar excludes "number").
          context={capacityDisplayMode}
        />
      )}
      <div className="relative z-10">
        <WeekValues result={result} capacityDisplayMode={capacityDisplayMode} />
      </div>
    </TableCell>
  );
}

function CapacityTableBody({
  model,
  collapsedGroups,
  toggleGroup,
  rowHeight,
  groupHeight,
  showTotals,
  capacityDisplayMode,
  personScheduleTitlesByResourceId,
  onViewSchedule,
}: {
  model: CapacityOverviewModel;
  collapsedGroups: Set<string>;
  toggleGroup: (key: string) => void;
  rowHeight: number;
  groupHeight: number;
  showTotals: boolean;
  capacityDisplayMode: CapacityDisplayMode;
} & PersonScheduleTriggerHandlers) {
  const hasRows = model.groups.some((group) => group.rows.length > 0);
  return (
    <TableBody>
      {model.groups.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        return (
          <Fragment key={group.key}>
            <GroupHeader
              group={group}
              collapsed={collapsed}
              onToggle={() => toggleGroup(group.key)}
              height={groupHeight}
              showTotals={showTotals}
            />
            {!collapsed &&
              group.rows.map((row) => (
                <TableRow key={row.resource.id} className="bg-scheduler-canvas" style={{ height: rowHeight }}>
                  <TableHead scope="row" className="h-auto min-w-0 whitespace-normal px-4 font-normal">
                    <PersonIdentity
                      group={group}
                      row={row}
                      personScheduleTitlesByResourceId={personScheduleTitlesByResourceId}
                      onViewSchedule={onViewSchedule}
                    />
                  </TableHead>
                  {row.weeks.map((result) => (
                    <WeekValuesCell key={result.week.key} result={result} capacityDisplayMode={capacityDisplayMode} />
                  ))}
                </TableRow>
              ))}
          </Fragment>
        );
      })}
      {!hasRows && (
        <TableRow>
          <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
            {m.capacity_overview_no_people()}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

function CapacityTable({
  model,
  showTotals,
  capacityDisplayMode,
  personScheduleTitlesByResourceId,
  onViewSchedule,
}: {
  model: CapacityOverviewModel;
  showTotals: boolean;
  capacityDisplayMode: CapacityDisplayMode;
} & PersonScheduleTriggerHandlers) {
  const density = useSchedulerDensity();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Table aria-label={m.capacity_overview_title()} className="table-fixed">
      <colgroup>
        <col className="w-[32%]" />
        {model.weeks.map((week) => (
          <col key={week.key} className="w-[17%]" />
        ))}
      </colgroup>
      <TableHeader className="bg-scheduler-header">
        <TableRow className="hover:bg-transparent">
          <TableHead className="px-4">{m.capacity_overview_person()}</TableHead>
          {model.weeks.map((week) => (
            <TableHead key={week.key} className="whitespace-normal px-2 text-center">
              {formatWeekColumnRange(week.start, week.end)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <CapacityTableBody
        model={model}
        collapsedGroups={collapsedGroups}
        toggleGroup={toggleGroup}
        rowHeight={density.identityBandHeight}
        groupHeight={density.groupHeaderHeight}
        showTotals={showTotals}
        capacityDisplayMode={capacityDisplayMode}
        personScheduleTitlesByResourceId={personScheduleTitlesByResourceId}
        onViewSchedule={onViewSchedule}
      />
    </Table>
  );
}

interface CapacityOverviewTableWithScheduleProps extends CapacityOverviewTableProps {
  /** Scoped account data used to resolve person schedule titles. */
  data: AppData;
  /** Restores focus to a stable element when the drawer's opener has been removed from the DOM.
   *  Defaults to an internal ref on this component's own root when not supplied. */
  fallbackRef?: RefObject<HTMLDivElement | null>;
}

export function CapacityOverviewTable(props: CapacityOverviewTableWithScheduleProps) {
  const internalFallbackRef = useRef<HTMLDivElement>(null);
  const fallbackRef = props.fallbackRef ?? internalFallbackRef;
  const personScheduleDrawer = usePersonScheduleDrawer({ data: props.data, fallbackRef });
  return (
    // `tabIndex={-1}` makes this a valid focus target: when the drawer closes after its opening
    // trigger has left the DOM (a filter or collapsed group hid that row), the drawer restores
    // focus here, and `focus()` on a plain div without a tabindex is a no-op. Matches the
    // scheduler's own fallback target.
    <div ref={fallbackRef} tabIndex={-1} className="flex h-full min-h-0 flex-col">
      <OverviewToolbar {...props} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!props.model.measured ? (
          <div className="p-6">
            <Alert>
              <AlertTitle>
                <h2>{m.capacity_overview_blocks_heading()}</h2>
              </AlertTitle>
              <AlertDescription>{m.capacity_overview_blocks_body()}</AlertDescription>
            </Alert>
          </div>
        ) : (
          <CapacityTable
            model={props.model}
            showTotals={props.showTotals}
            capacityDisplayMode={props.capacityDisplayMode}
            personScheduleTitlesByResourceId={personScheduleDrawer.titlesByResourceId}
            onViewSchedule={personScheduleDrawer.viewSchedule}
          />
        )}
      </div>
      <PersonScheduleSheet
        open={personScheduleDrawer.open}
        schedule={personScheduleDrawer.schedule}
        onOpenChange={personScheduleDrawer.setOpen}
        onRestoreFocus={personScheduleDrawer.restoreFocus}
      />
    </div>
  );
}
