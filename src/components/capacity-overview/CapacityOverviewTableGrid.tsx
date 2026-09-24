import { isPlaceholderResource } from "@capacitylens/shared/types/entities";
import type { ID } from "@capacitylens/shared/types/entities";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { m } from "@/i18n";
import { formatWeekColumnRange } from "@/lib/dateDisplay";
import { resolveResourceDisplayName } from "@/lib/metadata";
import { useStore } from "../../store/useStore";
import { PersonScheduleTrigger } from "../person-schedule/PersonScheduleTrigger";
import { buildPeriodTotals } from "./capacityOverviewBar";
import type { CapacityDisplayMode } from "./capacityOverviewBar";
import type { CapacityOverviewPeriod } from "./capacityOverviewDates";
import { PeriodCell, TotalsCell } from "./CapacityOverviewCells";
import type { CapacityOverviewGroup, CapacityOverviewModel } from "./capacityOverviewModel";
import { SURFACE_2_CLASS } from "./OverviewLegend";

export interface PersonScheduleTriggerHandlers {
  personScheduleTitlesByResourceId: ReadonlyMap<string, string>;
  onViewSchedule: (resourceId: ID, opener: HTMLButtonElement) => void;
}

interface ResourceAvatarProp {
  resourceAvatars: ReadonlyMap<string, string>;
}

// The person column is sticky so rows pass under it while the week columns scroll. Every sticky
// cell paints an opaque background of its own row's surface for that reason.
const STICKY_CLASS = "sticky left-0 z-10 min-w-[230px] text-left";

function formatPeopleCount(count: number): string {
  return count === 1
    ? m.capacity_overview_people_one({ count: String(count) })
    : m.capacity_overview_people_other({ count: String(count) });
}

function GroupRow({
  group,
  collapsed,
  onToggle,
  periodCount,
}: {
  group: CapacityOverviewGroup;
  collapsed: boolean;
  onToggle: () => void;
  periodCount: number;
}) {
  const people = group.rows.filter((row) => row.resource.kind !== "placeholder").length;
  return (
    <tr data-testid="capacity-overview-group" className={SURFACE_2_CLASS}>
      <th scope="row" className={`${STICKY_CLASS} ${SURFACE_2_CLASS} border-b border-line-soft p-0 font-normal`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex w-full cursor-pointer items-center gap-[9px] px-[18px] py-[9px] text-[11px] [[data-compact]_&]:py-1 font-semibold uppercase tracking-[.09em] text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="size-3.5 text-faint" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-3.5 text-faint" />
          )}
          <span
            aria-hidden="true"
            className="inline-block size-[5px] shrink-0 rounded-full"
            style={{ backgroundColor: group.color ?? "var(--color-faint)" }}
          />
          <span className="min-w-0 truncate">{group.title}</span>
          {people > 0 ? (
            <span className="shrink-0 font-mono text-[11.5px] font-normal tracking-normal normal-case whitespace-nowrap text-faint">
              {formatPeopleCount(people)}
            </span>
          ) : null}
        </button>
      </th>
      {Array.from({ length: periodCount }, (_unused, index) => (
        <td key={index} className="border-b border-l border-line-soft p-0" />
      ))}
    </tr>
  );
}

function PersonCell({
  group,
  row,
  personScheduleTitlesByResourceId,
  onViewSchedule,
  resourceAvatars,
}: { group: CapacityOverviewGroup; row: CapacityOverviewGroup["rows"][number] } & PersonScheduleTriggerHandlers &
  ResourceAvatarProp) {
  const { resource } = row;
  const scheduleTitle = personScheduleTitlesByResourceId.get(resource.id) ?? resolveResourceDisplayName(resource);
  const imageUrl = resource.kind === "person" ? (resource.avatarUrl ?? resourceAvatars.get(resource.id)) : undefined;
  return (
    <th
      scope="row"
      className={`${STICKY_CLASS} border-b border-line-soft bg-surface px-[18px] py-2 font-normal [[data-compact]_&]:py-1`}
    >
      <div className="flex min-w-0 items-center gap-[11px]">
        <PersonScheduleTrigger
          resourceId={resource.id}
          scheduleTitle={scheduleTitle}
          avatarName={resource.name ?? resource.role}
          color={group.color ?? resource.color}
          placeholder={isPlaceholderResource(resource)}
          {...(imageUrl ? { imageUrl } : {})}
          onViewSchedule={onViewSchedule}
        />
        <div className="min-w-0">
          <span className="block truncate text-[13.5px] font-[550] tracking-[-0.005em] text-ink">
            {resolveResourceDisplayName(resource)}
          </span>
          <span className="block truncate text-[11.5px] text-faint">{resource.role}</span>
        </div>
      </div>
    </th>
  );
}

function CapacityTableHead({
  periods,
  rangeLabels,
  totals,
}: {
  periods: CapacityOverviewPeriod[];
  rangeLabels: string[];
  totals: ReturnType<typeof buildPeriodTotals> | undefined;
}) {
  // The bottom rule belongs to the last header tier, so toggling Totals never changes the header's
  // weight; the person cell of the totals tier stays empty so the column width cannot shift.
  const labelRule = totals ? "border-b-0 pb-1.5" : "border-b border-line pb-3";
  return (
    <thead>
      <tr>
        <th
          scope="col"
          className={`${STICKY_CLASS} z-20 bg-surface px-[18px] pt-3 text-[11px] font-semibold uppercase tracking-[.09em] text-faint ${labelRule}`}
        >
          {m.capacity_overview_person()}
        </th>
        {periods.map((period, index) => (
          <th
            key={period.key}
            scope="col"
            className={`whitespace-nowrap border-l border-line-soft px-3.5 pt-3 text-center text-[11.5px] font-medium text-muted-foreground ${labelRule}`}
          >
            {rangeLabels[index]}
          </th>
        ))}
      </tr>
      {totals && (
        <tr data-testid="capacity-overview-totals" aria-label={m.capacity_overview_totals_row()}>
          <td className={`${STICKY_CLASS} z-20 border-b border-line bg-surface p-0`} />
          {periods.map((period, index) => {
            const periodTotals = totals[index];
            return periodTotals ? (
              <TotalsCell key={period.key} totals={periodTotals} rangeLabel={rangeLabels[index] ?? ""} />
            ) : null;
          })}
        </tr>
      )}
    </thead>
  );
}

function CapacityTableBody({
  model,
  rangeLabels,
  collapsedGroups,
  toggleGroup,
  capacityDisplayMode,
  personScheduleTitlesByResourceId,
  onViewSchedule,
  resourceAvatars,
}: {
  model: CapacityOverviewModel;
  rangeLabels: string[];
  collapsedGroups: Set<string>;
  toggleGroup: (key: string) => void;
  capacityDisplayMode: CapacityDisplayMode;
} & PersonScheduleTriggerHandlers &
  ResourceAvatarProp) {
  const hasRows = model.groups.some((group) => group.rows.length > 0);
  return (
    <tbody>
      {model.groups.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        return (
          <Fragment key={group.key}>
            <GroupRow
              group={group}
              collapsed={collapsed}
              onToggle={() => toggleGroup(group.key)}
              periodCount={model.periods.length}
            />
            {!collapsed &&
              group.rows.map((row) => (
                <tr key={row.resource.id} className="bg-surface">
                  <PersonCell
                    group={group}
                    row={row}
                    personScheduleTitlesByResourceId={personScheduleTitlesByResourceId}
                    onViewSchedule={onViewSchedule}
                    resourceAvatars={resourceAvatars}
                  />
                  {row.periods.map((result) => (
                    <PeriodCell
                      key={result.period.key}
                      result={result}
                      capacityDisplayMode={capacityDisplayMode}
                      rangeLabel={rangeLabels[result.period.index] ?? ""}
                    />
                  ))}
                </tr>
              ))}
          </Fragment>
        );
      })}
      {!hasRows && (
        <tr>
          <td colSpan={model.periods.length + 1} className="py-8 text-center text-muted-foreground">
            {m.capacity_overview_no_people()}
          </td>
        </tr>
      )}
    </tbody>
  );
}

export function CapacityTable({
  model,
  showTotals,
  capacityDisplayMode,
  personScheduleTitlesByResourceId,
  onViewSchedule,
  resourceAvatars,
}: {
  model: CapacityOverviewModel;
  showTotals: boolean;
  capacityDisplayMode: CapacityDisplayMode;
} & PersonScheduleTriggerHandlers &
  ResourceAvatarProp) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const periods = model.periods;
  const rangeLabels = useMemo(
    () => periods.map((period) => formatWeekColumnRange(period.start, period.end)),
    [periods],
  );
  const totals = useMemo(
    () => (showTotals ? buildPeriodTotals(model.groups, periods.length) : undefined),
    [showTotals, model.groups, periods.length],
  );
  const toggleGroup = (key: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const compact = useStore((state) => state.compactView);
  return (
    <div
      data-testid="capacity-overview-table-region"
      data-compact={compact || undefined}
      role="region"
      aria-label={m.capacity_overview_table_region()}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.currentTarget.scrollBy({ left: event.key === "ArrowRight" ? 80 : -80 });
      }}
      className="min-w-0 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <table aria-label={m.capacity_overview_title()} className="w-full min-w-[720px] border-collapse text-sm">
        <colgroup>
          <col style={{ width: "22%" }} />
          {periods.map((period) => (
            <col key={period.key} style={{ width: `${(78 / periods.length).toFixed(3)}%` }} />
          ))}
        </colgroup>
        <CapacityTableHead periods={periods} rangeLabels={rangeLabels} totals={totals} />
        <CapacityTableBody
          model={model}
          rangeLabels={rangeLabels}
          collapsedGroups={collapsedGroups}
          toggleGroup={toggleGroup}
          capacityDisplayMode={capacityDisplayMode}
          personScheduleTitlesByResourceId={personScheduleTitlesByResourceId}
          onViewSchedule={onViewSchedule}
          resourceAvatars={resourceAvatars}
        />
      </table>
    </div>
  );
}
