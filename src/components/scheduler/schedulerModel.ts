import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { resolvePlaceholderDisplayName, resolveResourceDisplayName } from "@/lib/metadata";
import { buildExternalBand, buildDisciplineGroups, hasSupplementaryResources } from "@/store/schedulerSelectors";
import { isCapacityTracked } from "@capacitylens/shared/types/entities";
import type { AppData, ISODate, Resource, Weekday } from "@capacitylens/shared/types/entities";
import { NEUTRAL_COLOR } from "@/lib/palette";
import { laneLayout as compactLaneLayout } from "./layout";
import {
  createDisplayNameComparator,
  createEngagementFavouriteDisplayNameComparator,
  createFavouriteDisplayNameComparator,
} from "@/lib/displayOrder";
import {
  groupByResourceId,
  hasRenderableDateRange,
  reportInvalidScheduleDateRangeOnce,
} from "./schedulerModelIndexing";
import { createAllocationFilters } from "./schedulerModelFilters";
import { createRowBuilder } from "./schedulerRowModel";
import { createCapacitySource } from "./schedulerRowCapacity";
import type { GroupModel, SchedulerModelOptions, SchedulerResourceGroup } from "./schedulerModelTypes";

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

// The scheduler's pure projection owns view-model shapes; presentation consumes those shapes without introducing a reverse dependency. Computation errors must propagate rather than be swallowed.

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

/** Projects scoped scheduling data into grouped resource rows and visible bars. */
export function buildSchedulerModel(options: SchedulerModelOptions): GroupModel[] {
  const { data, filters, preferences } = options;
  const { disciplinesEnabled, accountWorkingDays = [1, 2, 3, 4, 5], blocksMode = false } = preferences;

  const groupByEngagement = hasSupplementaryResources(data.resources);
  // Resolve the shared placeholder label once per model build so sorting reuses it while still following the active locale.
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

export { applyVisibleUtilization } from "./schedulerVisibleUtilization";
