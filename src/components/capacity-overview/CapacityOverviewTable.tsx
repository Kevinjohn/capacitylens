import { isPlaceholderResource } from "@capacitylens/shared/types/entities";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { m } from "@/i18n";
import { formatDayMonthRange } from "@/lib/dateDisplay";
import { resolveResourceDisplayName } from "@/lib/metadata";
import { Avatar, SegmentedControl } from "../common/ui";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useSchedulerDensity } from "../scheduler/layout";
import { capacityBarFillStyle, computeCapacityBarFill, formatWeekValueText } from "./capacityOverviewBar";
import type { CapacityBarFill, CapacityBarFillContext, CapacityDisplayMode } from "./capacityOverviewBar";
import type {
  CapacityOverviewGroup,
  CapacityOverviewModel,
  CapacityOverviewSummaryWeek,
  CapacityOverviewWeekResult,
} from "./capacityOverviewModel";

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

function OverviewToolbar(props: CapacityOverviewTableProps) {
  const density = useSchedulerDensity();
  return (
    <div
      data-chrome-band="toolbar"
      className="flex flex-wrap items-center gap-2 border-b border-chrome-toolbar-border bg-chrome-toolbar px-4"
      style={{ paddingBlock: density.toolbarPadY, rowGap: density.toolbarGapY }}
    >
      <h1 className="mr-auto text-xl font-semibold">{m.capacity_overview_title()}</h1>
      <SegmentedControl
        ariaLabel={m.capacity_overview_tentative_filter()}
        value={props.includeTentative ? "show" : "hide"}
        onChange={(value) => props.onIncludeTentativeChange(value === "show")}
        options={[
          { value: "show", label: m.capacity_overview_show_tentative() },
          { value: "hide", label: m.capacity_overview_hide_tentative() },
        ]}
        geometry="connected"
        size="md"
      />
      <SegmentedControl
        ariaLabel={m.capacity_overview_availability_filter()}
        value={props.hasAvailability ? "available" : "everyone"}
        onChange={(value) => props.onHasAvailabilityChange(value === "available")}
        options={[
          { value: "everyone", label: m.capacity_overview_everyone() },
          { value: "available", label: m.capacity_overview_has_availability() },
        ]}
        geometry="connected"
        size="md"
      />
      <SegmentedControl
        ariaLabel={m.capacity_overview_totals_filter()}
        value={props.showTotals ? "show" : "hide"}
        onChange={(value) => props.onShowTotalsChange(value === "show")}
        options={[
          { value: "show", label: m.capacity_overview_show_totals() },
          { value: "hide", label: m.capacity_overview_hide_totals() },
        ]}
        geometry="connected"
        size="md"
      />
      <SegmentedControl
        ariaLabel={m.capacity_overview_display_mode_filter()}
        value={props.capacityDisplayMode}
        onChange={props.onCapacityDisplayModeChange}
        options={[
          { value: "bar", label: m.capacity_overview_display_mode_bar() },
          { value: "bar-number", label: m.capacity_overview_display_mode_bar_number() },
          { value: "number", label: m.capacity_overview_display_mode_number() },
        ]}
        geometry="connected"
        size="md"
      />
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

function PersonIdentity({ group, row }: { group: CapacityOverviewGroup; row: CapacityOverviewGroup["rows"][number] }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar
        name={row.resource.name ?? row.resource.role}
        color={group.color ?? row.resource.color}
        placeholder={isPlaceholderResource(row.resource)}
      />
      <div className="ms-1.5 min-w-0">
        <span className="block truncate text-sm font-medium">{resolveResourceDisplayName(row.resource)}</span>
        <span className="block truncate text-xs text-muted-foreground">{row.resource.role}</span>
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
            availableHours: result.availableHours,
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
}: {
  model: CapacityOverviewModel;
  collapsedGroups: Set<string>;
  toggleGroup: (key: string) => void;
  rowHeight: number;
  groupHeight: number;
  showTotals: boolean;
  capacityDisplayMode: CapacityDisplayMode;
}) {
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
                    <PersonIdentity group={group} row={row} />
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
}: {
  model: CapacityOverviewModel;
  showTotals: boolean;
  capacityDisplayMode: CapacityDisplayMode;
}) {
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
              {formatDayMonthRange(week.start, week.end)}
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
      />
    </Table>
  );
}

export function CapacityOverviewTable(props: CapacityOverviewTableProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
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
          />
        )}
      </div>
    </div>
  );
}
