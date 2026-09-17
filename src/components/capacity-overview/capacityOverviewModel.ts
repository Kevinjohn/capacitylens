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
import type { CapacityOverviewPeriod } from "./capacityOverviewDates";
import { buildCapacityOverviewPeriods } from "./capacityOverviewDates";
import type {
  BuildCapacityOverviewModelInput,
  CapacityOverviewGroup,
  CapacityOverviewModel,
  CapacityOverviewState,
  CapacityOverviewPeriodResult,
} from "./capacityOverviewTypes";
export type { CapacityOverviewHorizon, CapacityOverviewPeriod } from "./capacityOverviewDates";
export type {
  BuildCapacityOverviewModelInput,
  CapacityOverviewGroup,
  CapacityOverviewModel,
  CapacityOverviewRow,
  CapacityOverviewState,
  CapacityOverviewPeriodResult,
} from "./capacityOverviewTypes";

const DEFAULT_ACCOUNT_WORKING_DAYS: Weekday[] = [1, 2, 3, 4, 5];
export const HOURS_PER_DISPLAY_DAY = 8;
const QUARTER_DAY_HOURS = HOURS_PER_DISPLAY_DAY / 4;
const ROUNDING_EPSILON_HOURS = 1e-9;

interface GroupSeed {
  key: string;
  title: string;
  color?: string;
  resources: Resource[];
}

interface CalculatePeriodInput {
  resource: Resource;
  period: CapacityOverviewPeriod;
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

/** Free capacity rounds down to the quarter-day so a printed figure never promises time that is not there. */
export function roundDownQuarterDays(hours: number): number {
  return Math.max(0, Math.floor((hours + ROUNDING_EPSILON_HOURS) / QUARTER_DAY_HOURS) / 4);
}

/** Demand and overload round up so a printed figure never hides a fraction of a booking. */
export function roundUpQuarterDays(hours: number): number {
  return Math.max(0, Math.ceil((hours - ROUNDING_EPSILON_HOURS) / QUARTER_DAY_HOURS) / 4);
}

function resolvePersonState(availableHours: number, freeDays: number): Exclude<CapacityOverviewState, "unassigned"> {
  if (availableHours === 0) return "unavailable";
  return freeDays >= 0.25 ? "available" : "fully-booked";
}

function calculatePeriod({
  resource,
  period,
  allocations,
  timeOff,
  closures,
  accountWorkingDays,
}: CalculatePeriodInput): CapacityOverviewPeriodResult {
  const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
  // Tentative work is measured as the free time it consumes: the difference between the free
  // hours with confirmed work only and the free hours with every included allocation. That keeps
  // it clamped to the person's real spare capacity, so free + tentative never exceeds available.
  const confirmedAllocations = allocations.filter((allocation) => allocation.status !== "tentative");
  const hasTentative = confirmedAllocations.length !== allocations.length;
  let availableHours = 0;
  let freeHours = 0;
  let overHours = 0;
  let tentativeHours = 0;
  let unassignedDemandHours = 0;
  for (const date of eachDayISO(period.start, period.end)) {
    const dayInput = { resource, date, timeOff, effectiveWeek, closures };
    const day = buildDayCapacity({ ...dayInput, allocations });
    if (isPlaceholderResource(resource)) {
      unassignedDemandHours += day.allocated;
      continue;
    }
    const dayFree = Math.max(day.available - day.allocated, 0);
    availableHours += day.available;
    freeHours += dayFree;
    overHours += Math.max(day.allocated - day.available, 0);
    if (hasTentative) {
      const confirmed = buildDayCapacity({ ...dayInput, allocations: confirmedAllocations });
      tentativeHours += Math.max(Math.max(confirmed.available - confirmed.allocated, 0) - dayFree, 0);
    }
  }
  const freeDays = roundDownQuarterDays(freeHours);
  const overDays = roundUpQuarterDays(overHours);
  return {
    period,
    availableHours,
    freeHours,
    overHours,
    tentativeHours,
    freeDays,
    overDays,
    tentativeDays: roundDownQuarterDays(tentativeHours),
    unassignedDemandHours,
    unassignedDemandDays: roundUpQuarterDays(unassignedDemandHours),
    state: isPlaceholderResource(resource) ? "unassigned" : resolvePersonState(availableHours, freeDays),
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
  periods,
  indexes,
  closures,
  accountWorkingDays,
  groupResourcesByEngagement,
}: {
  seeds: GroupSeed[];
  periods: CapacityOverviewPeriod[];
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
      .map((resource) => {
        const resourcePeriods = periods.map((period) =>
          calculatePeriod({
            resource,
            period,
            allocations: indexes.allocationsByResource.get(resource.id) ?? [],
            timeOff: indexes.timeOffByResource.get(resource.id) ?? [],
            closures,
            accountWorkingDays,
          }),
        );
        return { resource, periods: resourcePeriods };
      });
    return { ...seed, rows };
  });
}

function applyAvailabilityFilter(groups: CapacityOverviewGroup[], hasAvailability: boolean): CapacityOverviewGroup[] {
  if (!hasAvailability) return groups;
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        isPlaceholderResource(row.resource)
          ? row.periods.some((period) => period.unassignedDemandDays > 0)
          : row.periods.some((period) => period.freeDays >= 0.25),
      ),
    }))
    .filter((group) => group.rows.length > 0);
}

// The model keeps eligibility, grouping, filtering and blocks-mode orchestration together so
// every displayed period follows the same scoped calculation path.
// eslint-disable-next-line complexity
export function buildCapacityOverviewModel({
  data,
  today,
  weekStartsOn = 1,
  horizon = "4-weeks",
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
  const periods = buildCapacityOverviewPeriods({ today, weekStartsOn, horizon });
  if (blocksMode) {
    return { measured: false, reason: "blocks-mode", periods, groups: [] };
  }

  const eligible = new Set(
    data.resources
      .filter((resource) => isEligibleResource(resource, placeholdersEnabled))
      .map((resource) => resource.id),
  );
  const indexes = buildIndexes({ data, eligible, includeTentative, timeOff });
  const groups = buildRows({
    seeds: buildGroupSeeds({ data, eligible, disciplinesEnabled, groupResourcesByEngagement }),
    periods,
    indexes,
    closures,
    accountWorkingDays,
    groupResourcesByEngagement,
  });
  return { measured: true, periods, groups: applyAvailabilityFilter(groups, hasAvailability) };
}
