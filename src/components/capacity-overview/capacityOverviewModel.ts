import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { isCapacityTracked, isExternalResource, isPlaceholderResource } from "@capacitylens/shared/types/entities";
import type { Allocation, AppData, Closure, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";
import {
  createDisplayNameComparator,
  createEngagementFavouriteDisplayNameComparator,
  createFavouriteDisplayNameComparator,
} from "../../lib/displayOrder";
import { resolveResourceDisplayName } from "../../lib/metadata";
import { buildDisciplineGroups } from "../../store/selectors";
import { buildDayCapacity } from "../../lib/capacity";
import type { CapacityOverviewWeek } from "./capacityOverviewDates";
import { buildCapacityOverviewWeeks } from "./capacityOverviewDates";
import type {
  BuildCapacityOverviewModelInput,
  CapacityOverviewGroup,
  CapacityOverviewModel,
  CapacityOverviewRow,
  CapacityOverviewState,
  CapacityOverviewSummary,
  CapacityOverviewWeekResult,
} from "./capacityOverviewTypes";
export type {
  BuildCapacityOverviewModelInput,
  CapacityOverviewGroup,
  CapacityOverviewModel,
  CapacityOverviewRow,
  CapacityOverviewState,
  CapacityOverviewSummary,
  CapacityOverviewSummaryWeek,
  CapacityOverviewWeekResult,
} from "./capacityOverviewTypes";

const DEFAULT_ACCOUNT_WORKING_DAYS: Weekday[] = [1, 2, 3, 4, 5];
const HOURS_PER_DISPLAY_DAY = 8;
const QUARTER_DAY_HOURS = HOURS_PER_DISPLAY_DAY / 4;
const ROUNDING_EPSILON_HOURS = 1e-9;

interface GroupSeed {
  key: string;
  title: string;
  color?: string;
  resources: Resource[];
}

interface CalculateWeekInput {
  resource: Resource;
  week: CapacityOverviewWeek;
  allocations: Allocation[];
  timeOff: TimeOff[];
  closures: Closure[];
  accountWorkingDays: Weekday[];
}

interface BuildGroupSeedsInput {
  data: AppData;
  eligible: Set<string>;
  disciplinesEnabled: boolean;
  groupResourcesByEngagement: boolean;
}

interface OverviewIndexes {
  allocationsByResource: Map<string, Allocation[]>;
  timeOffByResource: Map<string, TimeOff[]>;
}

function roundDownQuarterDays(hours: number): number {
  return Math.max(0, Math.floor((hours + ROUNDING_EPSILON_HOURS) / QUARTER_DAY_HOURS) / 4);
}

function roundUpQuarterDays(hours: number): number {
  return Math.max(0, Math.ceil((hours - ROUNDING_EPSILON_HOURS) / QUARTER_DAY_HOURS) / 4);
}

function resolvePersonState(availableHours: number, freeDays: number): Exclude<CapacityOverviewState, "unassigned"> {
  if (availableHours === 0) return "unavailable";
  return freeDays >= 0.25 ? "available" : "fully-booked";
}

function calculateWeek({
  resource,
  week,
  allocations,
  timeOff,
  closures,
  accountWorkingDays,
}: CalculateWeekInput): CapacityOverviewWeekResult {
  const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
  let availableHours = 0;
  let allocatedHours = 0;
  let freeHours = 0;
  let overHours = 0;
  let unassignedDemandHours = 0;
  for (const date of eachDayISO(week.start, week.end)) {
    const day = buildDayCapacity({
      resource,
      date,
      allocations,
      timeOff,
      effectiveWeek,
      closures,
    });
    allocatedHours += day.allocated;
    if (isPlaceholderResource(resource)) {
      unassignedDemandHours += day.allocated;
      continue;
    }
    availableHours += day.available;
    freeHours += Math.max(day.available - day.allocated, 0);
    overHours += Math.max(day.allocated - day.available, 0);
  }
  const freeDays = roundDownQuarterDays(freeHours);
  const overDays = roundUpQuarterDays(overHours);
  return {
    week,
    availableHours,
    allocatedHours,
    freeHours,
    overHours,
    freeDays,
    overDays,
    unassignedDemandHours,
    unassignedDemandDays: roundUpQuarterDays(unassignedDemandHours),
    state: isPlaceholderResource(resource) ? "unassigned" : resolvePersonState(availableHours, freeDays),
  };
}

function summarize(rows: CapacityOverviewRow[], overviewWeeks: CapacityOverviewWeek[] = []): CapacityOverviewSummary {
  const people = rows.filter((row) => isCapacityTracked(row.resource) && !isPlaceholderResource(row.resource));
  const placeholders = rows.filter((row) => isPlaceholderResource(row.resource));
  const weeks = (rows[0]?.weeks ?? overviewWeeks).map((_week, index) => {
    const availableHours = people.reduce((sum, row) => sum + (row.weeks[index]?.availableHours ?? 0), 0);
    const freeHours = people.reduce((sum, row) => sum + (row.weeks[index]?.freeHours ?? 0), 0);
    const overHours = people.reduce((sum, row) => sum + (row.weeks[index]?.overHours ?? 0), 0);
    const unassignedDemandHours = placeholders.reduce(
      (sum, row) => sum + (row.weeks[index]?.unassignedDemandHours ?? 0),
      0,
    );
    return {
      availableHours,
      freeHours,
      overHours,
      freeDays: roundDownQuarterDays(freeHours),
      overDays: roundUpQuarterDays(overHours),
      unassignedDemandHours,
      unassignedDemandDays: roundUpQuarterDays(unassignedDemandHours),
    };
  });
  return {
    scope: "all-eligible-people",
    peopleCount: people.length,
    placeholderCount: placeholders.length,
    weeks,
  };
}

function fallbackGroups(resources: Resource[], groupResourcesByEngagement: boolean): GroupSeed[] {
  if (!resources.length) return [];
  if (!groupResourcesByEngagement) return [{ key: "unassigned", title: "Unassigned", resources }];
  return (
    [
      {
        key: "engagement-studio",
        title: "Studio",
        resources: resources.filter((resource) => resource.engagement === "studio"),
      },
      {
        key: "engagement-supplementary",
        title: "Supplementary",
        resources: resources.filter((resource) => resource.engagement === "supplementary"),
      },
    ] satisfies GroupSeed[]
  ).filter((group) => group.resources.length > 0);
}

function createResourceComparator(groupResourcesByEngagement: boolean) {
  const byDisplayName = createDisplayNameComparator<Resource>(resolveResourceDisplayName);
  const byFavouriteDisplayName = createFavouriteDisplayNameComparator<Resource>(resolveResourceDisplayName);
  const byEngagementFavouriteDisplayName =
    createEngagementFavouriteDisplayNameComparator<Resource>(resolveResourceDisplayName);
  return (left: Resource, right: Resource): number => {
    const placeholderOrder = Number(left.kind === "placeholder") - Number(right.kind === "placeholder");
    if (placeholderOrder !== 0) return placeholderOrder;
    if (left.kind === "placeholder") return byDisplayName(left, right);
    return groupResourcesByEngagement
      ? byEngagementFavouriteDisplayName(left, right)
      : byFavouriteDisplayName(left, right);
  };
}

function buildGroupSeeds({
  data,
  eligible,
  disciplinesEnabled,
  groupResourcesByEngagement,
}: BuildGroupSeedsInput): GroupSeed[] {
  const eligibleResources = data.resources.filter((resource) => eligible.has(resource.id));
  const placeholders = eligibleResources.filter(isPlaceholderResource);
  const people = eligibleResources.filter((resource) => !isPlaceholderResource(resource));
  if (!disciplinesEnabled) {
    let peopleGroups: GroupSeed[] = [];
    if (groupResourcesByEngagement) {
      peopleGroups = fallbackGroups(people, true);
    } else if (people.length) {
      peopleGroups = [{ key: "overall", title: "Overall", resources: people }];
    }
    return [
      ...peopleGroups,
      ...(placeholders.length ? [{ key: "placeholders", title: "Unassigned demand", resources: placeholders }] : []),
    ];
  }
  const groups: GroupSeed[] = [];
  for (const group of buildDisciplineGroups(data)) {
    if (group.external) continue;
    const resources = group.resources.filter(
      (resource) => eligible.has(resource.id) && !isPlaceholderResource(resource),
    );
    if (!resources.length) continue;
    if (group.discipline) {
      groups.push({
        key: group.discipline.id,
        title: group.discipline.name,
        ...(group.discipline.color ? { color: group.discipline.color } : {}),
        resources,
      });
    } else {
      groups.push(...fallbackGroups(resources, groupResourcesByEngagement));
    }
  }
  return [
    ...groups,
    ...(placeholders.length ? [{ key: "placeholders", title: "Unassigned demand", resources: placeholders }] : []),
  ];
}

function isEligibleResource(resource: Resource, placeholdersEnabled: boolean): boolean {
  if (!isCapacityTracked(resource) || isExternalResource(resource)) return false;
  if (resource.archivedAt !== undefined || resource.deletedAt !== undefined) return false;
  if (isPlaceholderResource(resource)) return placeholdersEnabled;
  return true;
}

function buildIndexes({
  data,
  eligible,
  includeTentative,
  timeOff,
}: {
  data: AppData;
  eligible: Set<string>;
  includeTentative: boolean;
  timeOff: TimeOff[];
}): OverviewIndexes {
  const allocationsByResource = new Map<string, Allocation[]>();
  for (const allocation of data.allocations) {
    if (!eligible.has(allocation.resourceId)) continue;
    if (!includeTentative && allocation.status === "tentative") continue;
    const rows = allocationsByResource.get(allocation.resourceId);
    if (rows) rows.push(allocation);
    else allocationsByResource.set(allocation.resourceId, [allocation]);
  }
  const timeOffByResource = new Map<string, TimeOff[]>();
  for (const entry of timeOff) {
    if (!eligible.has(entry.resourceId)) continue;
    const rows = timeOffByResource.get(entry.resourceId);
    if (rows) rows.push(entry);
    else timeOffByResource.set(entry.resourceId, [entry]);
  }
  return { allocationsByResource, timeOffByResource };
}

function buildRows({
  seeds,
  weeks,
  indexes,
  closures,
  accountWorkingDays,
  groupResourcesByEngagement,
}: {
  seeds: GroupSeed[];
  weeks: CapacityOverviewWeek[];
  indexes: OverviewIndexes;
  closures: Closure[];
  accountWorkingDays: Weekday[];
  groupResourcesByEngagement: boolean;
}): CapacityOverviewGroup[] {
  const compareResources = createResourceComparator(groupResourcesByEngagement);
  return seeds.map((seed) => {
    const rows = seed.resources
      .slice()
      .sort(compareResources)
      .map((resource) => ({
        resource,
        weeks: weeks.map((week) =>
          calculateWeek({
            resource,
            week,
            allocations: indexes.allocationsByResource.get(resource.id) ?? [],
            timeOff: indexes.timeOffByResource.get(resource.id) ?? [],
            closures,
            accountWorkingDays,
          }),
        ),
      }));
    return { ...seed, rows, summary: summarize(rows, weeks) };
  });
}

function applyAvailabilityFilter(groups: CapacityOverviewGroup[], hasAvailability: boolean): CapacityOverviewGroup[] {
  if (!hasAvailability) return groups;
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        isPlaceholderResource(row.resource)
          ? row.weeks.some((week) => week.unassignedDemandDays > 0)
          : row.weeks.some((week) => week.freeDays >= 0.25),
      ),
    }))
    .filter((group) => group.rows.length > 0);
}

export function buildCapacityOverviewModel({
  data,
  today,
  weekStartsOn = 1,
  accountWorkingDays = DEFAULT_ACCOUNT_WORKING_DAYS,
  includeTentative = true,
  placeholdersEnabled = false,
  hasAvailability = false,
  disciplinesEnabled = true,
  groupResourcesByEngagement = true,
  blocksMode = false,
  timeOff = data.timeOff,
  closures = data.closures,
}: BuildCapacityOverviewModelInput): CapacityOverviewModel {
  const weeks = buildCapacityOverviewWeeks({ today, weekStartsOn });
  if (blocksMode) return { measured: false, reason: "blocks-mode", weeks, groups: [], summary: summarize([], weeks) };

  const eligible = new Set(
    data.resources
      .filter((resource) => isEligibleResource(resource, placeholdersEnabled))
      .map((resource) => resource.id),
  );
  const indexes = buildIndexes({ data, eligible, includeTentative, timeOff });
  const groups = buildRows({
    seeds: buildGroupSeeds({ data, eligible, disciplinesEnabled, groupResourcesByEngagement }),
    weeks,
    indexes,
    closures,
    accountWorkingDays,
    groupResourcesByEngagement,
  });
  const allRows = groups.flatMap((group) => group.rows);
  return {
    measured: true,
    weeks,
    groups: applyAvailabilityFilter(groups, hasAvailability),
    summary: summarize(allRows, weeks),
  };
}
