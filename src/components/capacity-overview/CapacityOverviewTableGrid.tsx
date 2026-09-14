import { isPlaceholderResource } from "@capacitylens/shared/types/entities";
import type { ID } from "@capacitylens/shared/types/entities";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { m } from "@/i18n";
import { formatDayMonthRange, formatWeekColumnRange } from "@/lib/dateDisplay";
import { resolveResourceDisplayName } from "@/lib/metadata";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useSchedulerDensity } from "../scheduler/layout";
import { PersonScheduleTrigger } from "../person-schedule/PersonScheduleTrigger";
import { computeCapacityBarFill, formatWeekValueText } from "./capacityOverviewBar";
import type { CapacityDisplayMode } from "./capacityOverviewBar";
import { CapacityBarFillLayer } from "./CapacityBarFillLayer";
import type {
  CapacityOverviewGroup,
  CapacityOverviewModel,
  CapacityOverviewPeriodResult,
  CapacityOverviewSummaryPeriod,
} from "./capacityOverviewModel";

export interface PersonScheduleTriggerHandlers {
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

function PeriodValues({
  result,
  capacityDisplayMode,
}: {
  result: CapacityOverviewPeriodResult;
  capacityDisplayMode: CapacityDisplayMode;
}) {
  if (result.state === "unassigned") {
    return result.unassignedDemandDays > 0 ? (
      <span>{formatDays(result.unassignedDemandDays, "unassigned")}</span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }
  if (capacityDisplayMode === "bar") {
    return <span className="sr-only">{formatWeekValueText(result, formatDays, "—")}</span>;
  }
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

function SummaryValues({ result, peopleCount }: { result: CapacityOverviewSummaryPeriod; peopleCount: number }) {
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

function strategicLabel(key: string): string | undefined {
  if (key === "weeks-5-8") return m.capacity_overview_weeks_5_8();
  if (key === "weeks-9-12") return m.capacity_overview_weeks_9_12();
  return undefined;
}

function PeriodHeading({ start, end, keyName }: { start: string; end: string; keyName: string }) {
  const label = strategicLabel(keyName);
  if (!label) return <>{formatWeekColumnRange(start, end)}</>;
  const range = formatDayMonthRange(start, end);
  return (
    <>
      <span className="block">{label}</span>
      <span className="block text-xs font-normal">{range}</span>
    </>
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
  const periods = group.summary.periods;
  return (
    <TableRow
      data-testid="capacity-overview-group"
      className="bg-scheduler-group hover:bg-scheduler-group"
      style={{ height }}
    >
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
      {periods.map((result, index) => (
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
}: { group: CapacityOverviewGroup; row: CapacityOverviewGroup["rows"][number] } & PersonScheduleTriggerHandlers) {
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
        {...(resource.kind === "person" && resource.avatarUrl ? { imageUrl: resource.avatarUrl } : {})}
        onViewSchedule={onViewSchedule}
      />
      <div className="ms-1.5 min-w-0">
        <span className="block truncate text-sm font-medium">{resolveResourceDisplayName(resource)}</span>
        <span className="block truncate text-xs text-muted-foreground">{resource.role}</span>
      </div>
    </div>
  );
}

function PeriodValuesCell({
  result,
  capacityDisplayMode,
}: {
  result: CapacityOverviewPeriodResult;
  capacityDisplayMode: CapacityDisplayMode;
}) {
  const showBar = capacityDisplayMode !== "number" && result.state !== "unassigned";
  return (
    <TableCell className="relative whitespace-normal px-2 text-center">
      {showBar && (
        <CapacityBarFillLayer
          fill={computeCapacityBarFill({
            companyWorkingHours: result.companyWorkingHours,
            freeHours: result.freeHours,
            overHours: result.overHours,
          })}
          context={capacityDisplayMode}
        />
      )}
      <div className="relative z-10">
        <PeriodValues result={result} capacityDisplayMode={capacityDisplayMode} />
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
              group.rows.map((row) => {
                const rowPeriods = row.periods;
                return (
                  <TableRow key={row.resource.id} className="bg-scheduler-canvas" style={{ height: rowHeight }}>
                    <TableHead scope="row" className="h-auto min-w-0 whitespace-normal px-4 font-normal">
                      <PersonIdentity
                        group={group}
                        row={row}
                        personScheduleTitlesByResourceId={personScheduleTitlesByResourceId}
                        onViewSchedule={onViewSchedule}
                      />
                    </TableHead>
                    {rowPeriods.map((result) => (
                      <PeriodValuesCell
                        key={result.period.key}
                        result={result}
                        capacityDisplayMode={capacityDisplayMode}
                      />
                    ))}
                  </TableRow>
                );
              })}
          </Fragment>
        );
      })}
      {!hasRows && (
        <TableRow>
          <TableCell colSpan={model.periods.length + 1} className="py-8 text-center text-muted-foreground">
            {m.capacity_overview_no_people()}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

export function CapacityTable({
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
  const periods = model.periods;
  const toggleGroup = (key: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div
      data-testid="capacity-overview-table-region"
      role="region"
      aria-label={m.capacity_overview_table_region()}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.currentTarget.scrollBy({ left: event.key === "ArrowRight" ? 80 : -80 });
      }}
      className="min-w-0 flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>[data-slot=table-container]]:overflow-visible"
    >
      <Table
        aria-label={m.capacity_overview_title()}
        className={`table-fixed ${periods.length > 4 ? "min-w-[760px]" : ""}`}
      >
        <colgroup>
          <col style={{ width: `${periods.length > 4 ? 28 : 32}%` }} />
          {periods.map((period) => (
            <col key={period.key} style={{ width: `${(100 - (periods.length > 4 ? 28 : 32)) / periods.length}%` }} />
          ))}
        </colgroup>
        <TableHeader className="bg-scheduler-header">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4">{m.capacity_overview_person()}</TableHead>
            {periods.map((period) => (
              <TableHead
                key={period.key}
                className="whitespace-normal px-2 text-center"
                {...(strategicLabel(period.key)
                  ? { "aria-label": `${strategicLabel(period.key)}, ${formatDayMonthRange(period.start, period.end)}` }
                  : {})}
              >
                <PeriodHeading start={period.start} end={period.end} keyName={period.key} />
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
    </div>
  );
}
