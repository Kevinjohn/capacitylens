import { applyCapacityMode, buildDayCapacity, resolveUtilizationFromCapacity } from "@/lib/capacity";
import { addDaysISO, eachDayISO, rangesOverlap } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { resolvePlaceholderDisplayName, resolveResourceDisplayName } from "@/lib/metadata";
import { buildExternalBand, buildDisciplineGroups, hasSupplementaryResources } from "@/store/selectors";
import {
  isCapacityTracked,
  isExternalResource,
  type AppData,
  type ISODate,
  type Resource,
  type Weekday,
} from "@capacitylens/shared/types/entities";
import { NEUTRAL_COLOR } from "@/lib/palette";
import { packLanes, resolveLaneTop, resolveRowHeightForLanes, type LaneLayout } from "@/lib/lanePacking";
import { laneLayout as compactLaneLayout } from "./layout";
import {
  createDisplayNameComparator,
  createEngagementFavouriteDisplayNameComparator,
  createFavouriteDisplayNameComparator,
} from "@/lib/displayOrder";
import {
  bucketByCoveredDate,
  groupByResourceId,
  hasRenderableDateRange,
  reportInvalidScheduleDateRangeOnce,
  NO_ALLOCATIONS,
  NO_TIME_OFF,
  NO_CLOSURES,
} from "./schedulerModelIndexing";
import { createAllocationFilters } from "./schedulerModelFilters";
import { createRowBuilder } from "./schedulerRowModel";
import { createCapacitySource } from "./schedulerRowCapacity";
import type { GroupModel, SchedulerModelOptions, SchedulerResourceGroup } from "./schedulerModelTypes";

interface ApplyVisibleUtilizationInput {
  model: GroupModel[];
  data: AppData;
  start: ISODate;
  end: ISODate;
  accountWorkingDays: Weekday[];
  blocksMode?: boolean | undefined;
  laneLayout?: LaneLayout | undefined;
  partiallyExposesNextColumn?: boolean | undefined;
}

interface BuildResourceGroupsInput {
  data: AppData;
  disciplinesEnabled: boolean;
  groupByEngagement: boolean;
}

interface BuildFallbackGroupsInput {
  resources: Resource[];
  groupByEngagement: boolean;
  /** The single band used when engagement grouping is off. */
  ungrouped: { key: string; title: string };
}

interface CreateResourceComparatorInput {
  groupByEngagement: boolean;
  comparators: {
    byDisplayName: (a: Resource, b: Resource) => number;
    byFavouriteDisplayName: (a: Resource, b: Resource) => number;
    byEngagementFavouriteDisplayName: (a: Resource, b: Resource) => number;
  };
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
} from "./schedulerModelTypes";

function includeRenderableDateRange<T extends { id: string; startDate: ISODate; endDate: ISODate }>(row: T): boolean {
  const renderable = hasRenderableDateRange(row);
  if (!renderable) reportInvalidScheduleDateRangeOnce(row);
  return renderable;
}

// Pure view-model builder for the scheduler: turns the dataset + window + filters
// into positioned bars, per-day capacity states, time-off blocks and utilisation,
// grouped by discipline. No React, independently unit-testable.
//
// The model owns the shapes the view renders (one-way data -> model -> view), so
// these live here and the presentational components import them from the model,
// not the other way round.

function projectVisibleLanes({
  row,
  start,
  end,
  layout,
  partiallyExposesNextColumn,
}: {
  row: GroupModel["rows"][number];
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
  data,
  start,
  end,
  accountWorkingDays,
  blocksMode = false,
  laneLayout = compactLaneLayout,
  partiallyExposesNextColumn = false,
}: ApplyVisibleUtilizationInput): GroupModel[] {
  const days = eachDayISO(start, end);
  const allocations = groupByResourceId(data.allocations, { include: includeRenderableDateRange });
  const personalTimeOff = groupByResourceId(data.timeOff, { include: includeRenderableDateRange });
  const closuresByDate = bucketByCoveredDate(data.closures.filter(includeRenderableDateRange), days);
  return model.map((group) => {
    const rows = group.rows.map((row) => {
      const visibleLanes = projectVisibleLanes({
        row,
        start,
        end,
        layout: laneLayout,
        partiallyExposesNextColumn,
      });
      // External / 3rd-party rows carry no capacity, so their 0 can never change (the same
      // starvation contract the build's capacity seam states).
      if (isExternalResource(row.resource)) {
        if (row.utilization === 0 && visibleLanes.bars === row.bars && visibleLanes.rowHeight === row.rowHeight) {
          return row;
        }
        return { ...row, ...visibleLanes, utilization: 0 };
      }
      const resourceAllocations = applyCapacityMode({
        allocations: allocations.get(row.resource.id) ?? [],
        blocksMode: blocksMode,
      });
      const resourceTimeOff = personalTimeOff.get(row.resource.id) ?? [];
      const effectiveWeek = effectiveWorkingWeek(row.resource, accountWorkingDays);
      // Bucket this resource's load and time off by the days they cover once, exactly as the full
      // build does, so a horizontal scroll costs O(days + coverage) per row instead of rescanning
      // every allocation on every day of the window. Bucket order follows the input, so the hours
      // are summed in the same order and the ratio is bit-identical to the rescan.
      const allocationsByDate = bucketByCoveredDate(resourceAllocations, days);
      const personalTimeOffByDate = bucketByCoveredDate(resourceTimeOff, days);
      const next = resolveUtilizationFromCapacity(
        days.map((date) =>
          buildDayCapacity({
            resource: row.resource,
            date: date,
            allocations: allocationsByDate.get(date) ?? NO_ALLOCATIONS,
            timeOff: personalTimeOffByDate.get(date) ?? NO_TIME_OFF,
            effectiveWeek: effectiveWeek,
            closures: closuresByDate.get(date) ?? NO_CLOSURES,
          }),
        ),
      );
      if (next === row.utilization && visibleLanes.bars === row.bars && visibleLanes.rowHeight === row.rowHeight) {
        return row;
      }
      return { ...row, ...visibleLanes, utilization: next };
    });
    return rows.some((row, index) => row !== group.rows[index]) ? { ...group, rows } : group;
  });
}

// With disciplines on, the single band holds people without a discipline ("Unassigned"); with
// disciplines off it holds everyone, so it takes the neutral navigation label instead.
const UNASSIGNED_BAND = { key: "unassigned", title: "Unassigned" };
const ALL_RESOURCES_BAND = { key: "resources", title: "Resources" };

function buildFallbackGroups({
  resources,
  groupByEngagement,
  ungrouped,
}: BuildFallbackGroupsInput): SchedulerResourceGroup[] {
  if (!groupByEngagement) {
    return resources.length ? [{ ...ungrouped, discipline: null, resources }] : [];
  }
  return [
    {
      key: "engagement-studio",
      title: "Studio",
      discipline: null,
      resources: resources.filter((resource) => resource.engagement === "studio"),
    },
    {
      key: "engagement-supplementary",
      title: "Supplementary",
      discipline: null,
      resources: resources.filter((resource) => resource.engagement === "supplementary"),
    },
  ].filter((group) => group.resources.length > 0);
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
    const unassigned = disciplineGroups.find((group) => !group.discipline && !group.external)?.resources ?? [];
    groups.push(...buildFallbackGroups({ resources: unassigned, groupByEngagement, ungrouped: UNASSIGNED_BAND }));
  } else {
    groups.push(
      ...buildFallbackGroups({
        resources: data.resources.filter(isCapacityTracked),
        groupByEngagement,
        ungrouped: ALL_RESOURCES_BAND,
      }),
    );
  }
  const external = buildExternalBand(data.resources);
  if (external) {
    groups.push({ ...external, key: "external", title: "External / 3rd party", color: NEUTRAL_COLOR });
  }
  return groups;
}

function createResourceComparator({
  groupByEngagement,
  comparators,
}: CreateResourceComparatorInput): (a: Resource, b: Resource) => number {
  const comparePeople = groupByEngagement
    ? comparators.byEngagementFavouriteDisplayName
    : comparators.byFavouriteDisplayName;
  return (a, b) => {
    const placeholderOrder = Number(a.kind === "placeholder") - Number(b.kind === "placeholder");
    if (placeholderOrder !== 0) return placeholderOrder;
    return a.kind === "placeholder" ? comparators.byDisplayName(a, b) : comparePeople(a, b);
  };
}

function createSchedulerRowBuilder({ options, accountWorkingDays, blocksMode }: CreateSchedulerRowBuilderInput) {
  const { data, geom, days, visibleWindow, overSoonWindow, filters, preferences } = options;
  const allocationFilters = createAllocationFilters(filters, preferences, data);
  const seriesEndByKey = new Map<string, ISODate>();
  const allocationsByResource = groupByResourceId(data.allocations, {
    visit: (allocation) => {
      if (!allocation.seriesId || !isValidISODate(allocation.endDate)) return;
      const key = `${allocation.accountId}\u0000${allocation.seriesId}`;
      const current = seriesEndByKey.get(key);
      if (current === undefined || allocation.endDate > current) seriesEndByKey.set(key, allocation.endDate);
    },
  });
  const closures = data.closures.filter(includeRenderableDateRange);
  return {
    buildRow: createRowBuilder({
      model: { data, geom, days },
      accountWorkingDays,
      blocksMode,
      laneLayout: options.laneLayout ?? compactLaneLayout,
      allocationsByResource,
      timeOffByResource: groupByResourceId(data.timeOff.filter(includeRenderableDateRange)),
      seriesEndByKey,
      allocationFilters,
      capacitySource: createCapacitySource({ days, visibleWindow, overSoonWindow, closures, blocksMode }),
    }),
    resourceVisible: allocationFilters.resourceVisible,
  };
}

export function buildSchedulerModel(options: SchedulerModelOptions): GroupModel[] {
  const { data, filters, preferences } = options;
  const { disciplinesEnabled, accountWorkingDays = [1, 2, 3, 4, 5], blocksMode = false } = preferences;
  // Derived from the people themselves: Studio/Supplementary partitioning applies only once the
  // company has an active Supplementary resource, so a Studio-only company reads as one list.
  const groupByEngagement = hasSupplementaryResources(data.resources);
  // One i18n read per build for the placeholder label: the sort below calls the display name
  // O(n log n) times and every placeholder resolves the same word. Per build call, never module
  // scope: a Paraglide message must be called at use time so it follows the active locale.
  const placeholderLabel = resolvePlaceholderDisplayName();
  const resolveDisplayName = (resource: Resource): string =>
    resource.kind === "placeholder" ? placeholderLabel : resolveResourceDisplayName(resource);
  const byFavouriteResourceDisplayName = createFavouriteDisplayNameComparator<Resource>(resolveDisplayName);
  const byEngagementFavouriteResourceDisplayName =
    createEngagementFavouriteDisplayNameComparator<Resource>(resolveDisplayName);
  const byResourceDisplayName = createDisplayNameComparator<Resource>(resolveDisplayName);
  const byResourceOrder = createResourceComparator({
    groupByEngagement,
    comparators: {
      byDisplayName: byResourceDisplayName,
      byFavouriteDisplayName: byFavouriteResourceDisplayName,
      byEngagementFavouriteDisplayName: byEngagementFavouriteResourceDisplayName,
    },
  });
  const { buildRow, resourceVisible } = createSchedulerRowBuilder({ options, accountWorkingDays, blocksMode });

  // Assigned resources retain canonical discipline order. Every unassigned capacity-tracked row
  // then receives a useful engagement home; with disciplines off, that fallback becomes the whole
  // capacity grouping. External / 3rd party is deliberately appended last in both modes.
  const groups = buildResourceGroups({ data, disciplinesEnabled, groupByEngagement });
  return groups
    .map((group) => ({
      key: group.key,
      title: group.title,
      ...(group.color ? { color: group.color } : {}),
      external: !!group.external,
      // Keep discipline/external grouping intact. People are Studio then Supplementary when the
      // company has Supplementary people, with favourites first alphabetically inside each
      // partition. Placeholders remain after all people and have no favourite affordance.
      rows: group.resources
        .filter(resourceVisible)
        .sort(byResourceOrder)
        .map(buildRow)
        // Non-matching rows are hidden by default; the "Show unallocated" toggle opts
        // the dimmed staffing view back in.
        .filter((row) => filters.showUnmatched || !row.dimmed),
    }))
    .filter((group) => group.rows.length > 0);
}
