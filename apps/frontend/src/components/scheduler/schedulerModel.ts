import type { CapacitySection } from '@capacitylens/shared/lib/capacity';
import { addDaysISO, eachDayISO, rangesOverlap } from '@capacitylens/shared/lib/dateMath';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import {
  buildExternalBand,
  buildDisciplineGroups,
  hasSupplementaryResources,
} from '@/store/selectors';
import { isCapacityTracked, isExternalResource } from '@capacitylens/shared/types/entities';
import type { AppData, ISODate, Weekday } from '@capacitylens/shared/types/entities';
import { NEUTRAL_COLOR } from '@/lib/palette';
import { packLanes, resolveLaneTop, resolveRowHeightForLanes } from '@/lib/lanePacking';
import type { LaneLayout } from '@/lib/lanePacking';
import { laneLayout as compactLaneLayout } from './layout';
import {
  buildEngagementGroups,
  buildResourceBand,
  createResourceComparator,
} from '@/lib/resourceGrouping';
import { groupByResourceId } from './schedulerModelIndexing';
import { includeRenderableDateRange } from '@/lib/renderableDateRanges';
import { createAllocationFilters } from './schedulerModelFilters';
import { createRowBuilder } from './schedulerRowModel';
import { createCapacitySource, resolveServerUtilization } from './schedulerRowCapacity';
import type {
  GroupModel,
  SchedulerModelOptions,
  SchedulerResourceGroup,
} from './schedulerModelTypes';

interface ApplyVisibleUtilizationInput {
  model: GroupModel[];
  capacity: CapacitySection | null;
  start: ISODate;
  end: ISODate;
  laneLayout?: LaneLayout | undefined;
  partiallyExposesNextColumn?: boolean | undefined;
}

interface BuildResourceGroupsInput {
  data: AppData;
  disciplinesEnabled: boolean;
  groupByEngagement: boolean;
}

interface CreateSchedulerRowBuilderInput {
  options: SchedulerModelOptions;
  accountWorkingDays: Weekday[];
  blocksMode: boolean;
}

export type {
  BarLayout,
  DayState,
  TimeOffBlock,
  RowModel,
  GroupModel,
  SchedulerModelOptions,
} from './schedulerModelTypes';

// The scheduler's pure projection owns view-model shapes; presentation consumes those shapes without introducing a reverse dependency. Computation errors must propagate rather than be swallowed.

function projectVisibleLanes({
  row,
  start,
  end,
  layout,
  partiallyExposesNextColumn,
}: {
  row: GroupModel['rows'][number];
  start: ISODate;
  end: ISODate;
  layout: LaneLayout;
  partiallyExposesNextColumn: boolean;
}) {
  // The visible window is day-quantized, but a non-aligned scroll can expose the next column.
  // Pack that partial column too so its bars cannot fall through to lane 0 over visible work.
  const packingEnd = partiallyExposesNextColumn ? addDaysISO(end, 1) : end;
  const visibleBars = row.bars.filter(({ allocation }) =>
    rangesOverlap(allocation.startDate, allocation.endDate, start, packingEnd),
  );
  const { lanes, laneCount } = packLanes(visibleBars.map(({ allocation }) => allocation));
  const laneById = new Map(lanes.map(({ id, lane }) => [id, lane]));
  const bars = row.bars.map((bar) => {
    const top = resolveLaneTop(laneById.get(bar.allocation.id) ?? 0, layout);
    if (top === bar.top) return bar;
    return { ...bar, top };
  });
  const rowHeight = resolveRowHeightForLanes(laneCount, layout);
  return {
    bars: bars.some((bar, index) => bar !== row.bars[index]) ? bars : row.bars,
    rowHeight,
  };
}

/** Recompute the visible-window percentage and lane layout while retaining the expensive bar
 * geometry and timeline-day model. Horizontal scrolling changes this projection, not the static
 * schedule. Off-screen overlaps must not make the row taller than the work currently in view. */
export function applyVisibleUtilization({
  model,
  capacity,
  start,
  end,
  laneLayout = compactLaneLayout,
  partiallyExposesNextColumn = false,
}: ApplyVisibleUtilizationInput): GroupModel[] {
  const days = eachDayISO(start, end);
  return model.map((group) => {
    const rows = group.rows.map((row) => {
      const visibleLanes = projectVisibleLanes({
        row,
        start,
        end,
        layout: laneLayout,
        partiallyExposesNextColumn,
      });
      const next = isExternalResource(row.resource)
        ? 0
        : resolveServerUtilization(capacity, row.resource.id, days);
      if (
        next === row.utilization &&
        visibleLanes.bars === row.bars &&
        visibleLanes.rowHeight === row.rowHeight
      ) {
        return row;
      }
      return { ...row, ...visibleLanes, utilization: next };
    });
    return rows.some((row, index) => row !== group.rows[index]) ? { ...group, rows } : group;
  });
}

function buildResourceGroups({
  data,
  disciplinesEnabled,
  groupByEngagement,
}: BuildResourceGroupsInput): SchedulerResourceGroup[] {
  const groups: SchedulerResourceGroup[] = [];
  if (disciplinesEnabled) {
    const disciplineGroups = buildDisciplineGroups(data);
    for (const group of disciplineGroups) {
      if (group.discipline) {
        groups.push({
          ...group,
          key: group.discipline.id,
          title: group.discipline.name,
          ...(group.discipline.color ? { color: group.discipline.color } : {}),
        });
      }
    }
    const unassigned =
      disciplineGroups.find((group) => !group.discipline && !group.external)?.resources ?? [];
    const fallbackGroups = buildEngagementGroups({
      resources: unassigned,
      groupByEngagement,
      ungrouped: { ...buildResourceBand('unassigned'), color: NEUTRAL_COLOR },
    });
    groups.push(...fallbackGroups.map((group) => ({ ...group, discipline: null })));
  } else {
    const fallbackGroups = buildEngagementGroups({
      resources: data.resources.filter(isCapacityTracked),
      groupByEngagement,
      ungrouped: buildResourceBand('resources'),
    });
    groups.push(...fallbackGroups.map((group) => ({ ...group, discipline: null })));
  }
  const external = buildExternalBand(data.resources);
  if (external) {
    groups.push({ ...external, ...buildResourceBand('external'), color: NEUTRAL_COLOR });
  }
  return groups;
}

function createSchedulerRowBuilder({
  options,
  accountWorkingDays,
  blocksMode,
}: CreateSchedulerRowBuilderInput) {
  const { data, geom, days, visibleWindow, capacity, filters, preferences } = options;
  const allocationFilters = createAllocationFilters(filters, preferences, data);
  const seriesEndByKey = new Map<string, ISODate>();
  const allocationsByResource = groupByResourceId(data.allocations, {
    visit: (allocation) => {
      if (!allocation.seriesId || !isValidISODate(allocation.endDate)) return;
      const key = `${allocation.companyId}\u0000${allocation.seriesId}`;
      const current = seriesEndByKey.get(key);
      if (current === undefined || allocation.endDate > current) {
        seriesEndByKey.set(key, allocation.endDate);
      }
    },
  });
  const closures = data.closures.filter(includeRenderableDateRange);
  return {
    buildRow: createRowBuilder({
      model: { geom, days },
      accountWorkingDays,
      blocksMode,
      laneLayout: options.laneLayout ?? compactLaneLayout,
      allocationsByResource,
      timeOffByResource: groupByResourceId(data.timeOff.filter(includeRenderableDateRange)),
      closures,
      seriesEndByKey,
      allocationFilters,
      capacitySource: createCapacitySource({ days, visibleWindow, capacity, closures }),
    }),
    resourceVisible: allocationFilters.resourceVisible,
  };
}

/** Projects scoped scheduling data into grouped resource rows and visible bars. */
export function buildSchedulerModel(options: SchedulerModelOptions): GroupModel[] {
  const { data, filters, preferences } = options;
  const {
    disciplinesEnabled,
    accountWorkingDays = [1, 2, 3, 4, 5],
    blocksMode = false,
  } = preferences;

  const groupByEngagement = hasSupplementaryResources(data.resources);
  const byResourceOrder = createResourceComparator(groupByEngagement);
  const { buildRow, resourceVisible } = createSchedulerRowBuilder({
    options,
    accountWorkingDays,
    blocksMode,
  });

  const groups = buildResourceGroups({ data, disciplinesEnabled, groupByEngagement });
  return groups
    .map((group) => ({
      key: group.key,
      title: group.title,
      ...(group.color ? { color: group.color } : {}),
      external: !!group.external,

      rows: group.resources
        .filter(resourceVisible)
        .sort(byResourceOrder)
        .map(buildRow)

        .filter((row) => filters.showUnmatched || !row.dimmed),
    }))
    .filter((group) => group.rows.length > 0);
}
