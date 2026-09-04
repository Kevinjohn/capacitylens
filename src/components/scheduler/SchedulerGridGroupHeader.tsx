import { ChevronDown, ChevronRight } from "lucide-react";
import { m } from "@/i18n";
import { Button } from "../ui/button";
import { LAYOUT, schedulerDensity } from "./layout";
import type { GroupModel } from "./schedulerModel";
import type { SchedulerUI, StoreState } from "../../store/useStore";
import type { ColumnGeometry } from "./columnGeometry";
import { averageUtilizationPercent } from "./schedulerGridModal";

interface SchedulerGridGroupHeaderProps {
  group: GroupModel;
  rowIndex: number;
  ui: Pick<SchedulerUI, "collapsedGroups">;
  density: ReturnType<typeof schedulerDensity>;
  toggleGroup: (key: string) => void;
  geom: ColumnGeometry;
  utilizationPrefs: StoreState["utilizationPrefs"];
}
export function SchedulerGridGroupHeader({
  group,
  rowIndex,
  ui,
  density,
  toggleGroup,
  geom,
  utilizationPrefs,
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
        style={{ width: geom.totalWidth }}
      >
        {collapsed
          ? m.scheduler_group_hidden({ count: group.rows.length })
          : group.external
            ? "" /* external parties have no capacity — an avg utilisation here would misleadingly read 0% */
            : utilizationPrefs.showDiscipline
              ? m.scheduler_group_avg_utilisation({ percent: averageUtilizationPercent(group.rows) })
              : ""}
      </div>
    </div>
  );
}
