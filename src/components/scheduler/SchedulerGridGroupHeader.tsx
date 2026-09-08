import { ChevronDown, ChevronRight } from "lucide-react";
import { m } from "@/i18n";
import { Button } from "../ui/button";
import { LAYOUT, buildSchedulerDensity } from "./layout";
import type { GroupModel } from "./schedulerModel";
import type { SchedulerUI, StoreState } from "../../store/useStore";
import type { ColumnGeometry } from "./columnGeometry";
import { buildAverageUtilizationLabel } from "./schedulerGridModal";

interface SchedulerGridGroupHeaderProps {
  group: GroupModel;
  rowIndex: number;
  ui: Pick<SchedulerUI, "collapsedGroups">;
  density: ReturnType<typeof buildSchedulerDensity>;
  toggleGroup: (key: string) => void;
  geom: ColumnGeometry;
  utilizationPrefs: StoreState["utilizationPrefs"];
}

function resolveGroupSummary(group: GroupModel, collapsed: boolean, showDisciplineUtilization: boolean): string {
  if (collapsed) return m.scheduler_group_hidden({ count: group.rows.length });
  if (group.external || !showDisciplineUtilization) return "";
  return m.scheduler_group_avg_utilisation({ percent: buildAverageUtilizationLabel(group.rows) });
}

export function SchedulerGridGroupHeader({
  group,
  rowIndex,
  ui,
  density,
  toggleGroup,
  geom: geometry,
  utilizationPrefs: utilizationPreferences,
}: SchedulerGridGroupHeaderProps) {
  const collapsed = ui.collapsedGroups.includes(group.key);
  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      data-testid="discipline-group"
      className="flex border-y border-line-soft bg-scheduler-group text-faint"
      style={{ height: density.groupHeaderHeight }}
    >
      <div
        role="rowheader"
        aria-colindex={1}
        className="sticky left-0 z-10 shrink-0"
        style={{ width: LAYOUT.leftColWidth }}
      >
        <Button
          variant="ghost"
          onClick={() => toggleGroup(group.key)}
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
      </div>
      <div
        role="gridcell"
        aria-colindex={2}
        className="flex shrink-0 items-center px-3 text-xs"
        style={{ width: geometry.totalWidth }}
      >
        {resolveGroupSummary(group, collapsed, utilizationPreferences.showDiscipline)}
      </div>
    </div>
  );
}
