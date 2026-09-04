import { capacityAllocationsForMode, dayCapacity, utilizationFromCapacity } from "../../lib/capacity";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { placeholderDisplayName, resourceDisplayName } from "../../lib/metadata";
import { externalBand, resourcesByDiscipline } from "../../store/selectors";
import {
  isCapacityTracked,
  isExternalResource,
  type AppData,
  type ISODate,
  type Resource,
  type Weekday,
} from "@capacitylens/shared/types/entities";
import { NEUTRAL_COLOR } from "../../lib/palette";
import { laneLayout as compactLaneLayout } from "./layout";
import {
  displayNameComparator,
  engagementFavouriteDisplayNameComparator,
  favouriteDisplayNameComparator,
} from "../../lib/displayOrder";
import {
  bucketByCoveredDate,
  groupByResourceId,
  hasRenderableDateRange,
  NO_ALLOCATIONS,
  NO_TIME_OFF,
  NO_CLOSURES,
} from "./schedulerModelIndexing";
import { createAllocationFilters } from "./schedulerModelFilters";
import { createRowBuilder } from "./schedulerRowModel";
import { createCapacitySource } from "./schedulerRowCapacity";
import type { GroupModel, SchedulerModelOptions, SchedulerResourceGroup } from "./schedulerModelTypes";
export type {
  BarLayout,
  DayState,
  TimeOffBlock,
  RowModel,
  GroupModel,
  SchedulerModelOptions,
} from "./schedulerModelTypes";

// Pure view-model builder for the scheduler: turns the dataset + window + filters
// into positioned bars, per-day capacity states, time-off blocks and utilisation,
// grouped by discipline. No React — independently unit-testable.
//
// The model OWNS the shapes the view renders (one-way data -> model -> view), so
// these live here and the presentational components import them from the model —
// not the other way round.

/** Recompute only the visible-window percentage while retaining the expensive bar, lane and
 * timeline-day model. Horizontal scrolling changes this projection, not the static schedule. */
export function refreshVisibleUtilization(
  model: GroupModel[],
  data: AppData,
  start: ISODate,
  end: ISODate,
  accountWorkingDays: Weekday[],
  blocksMode = false,
): GroupModel[] {
  const days = eachDayISO(start, end);
  const allocations = groupByResourceId(data.allocations, { include: hasRenderableDateRange });
  const personalTimeOff = groupByResourceId(data.timeOff, { include: hasRenderableDateRange });
  const closuresByDate = bucketByCoveredDate(data.closures.filter(hasRenderableDateRange), days);
  return model.map((group) => {
    let changed = false;
    const rows = group.rows.map((row) => {
      // External / 3rd-party rows carry no capacity, so their 0 can never change (the same
      // starvation contract the build's capacity seam states).
      if (isExternalResource(row.resource)) {
        if (row.utilization === 0) return row;
        changed = true;
        return { ...row, utilization: 0 };
      }
      const resourceAllocations = capacityAllocationsForMode(allocations.get(row.resource.id) ?? [], blocksMode);
      const resourceTimeOff = personalTimeOff.get(row.resource.id) ?? [];
      const effectiveWeek = effectiveWorkingWeek(row.resource, accountWorkingDays);
      // Bucket this resource's load and time off by the days they cover ONCE, exactly as the full
      // build does, so a horizontal scroll costs O(days + coverage) per row instead of rescanning
      // every allocation on every day of the window. Bucket order follows the input, so the hours
      // are summed in the same order and the ratio is bit-identical to the rescan.
      const allocsByDate = bucketByCoveredDate(resourceAllocations, days);
      const personalTimeOffByDate = bucketByCoveredDate(resourceTimeOff, days);
      const next = utilizationFromCapacity(
        days.map((date) =>
          dayCapacity(
            row.resource,
            date,
            allocsByDate.get(date) ?? NO_ALLOCATIONS,
            personalTimeOffByDate.get(date) ?? NO_TIME_OFF,
            effectiveWeek,
            closuresByDate.get(date) ?? NO_CLOSURES,
          ),
        ),
      );
      if (next === row.utilization) return row;
      changed = true;
      return { ...row, utilization: next };
    });
    return changed ? { ...group, rows } : group;
  });
}

export function buildSchedulerModel(options: SchedulerModelOptions): GroupModel[] {
  const {
    data,
    geom,
    days,
    visibleWindow,
    overSoonWindow,
    filters,
    preferences,
    laneLayout = compactLaneLayout,
  } = options;
  const {
    disciplinesEnabled,
    accountWorkingDays = [1, 2, 3, 4, 5],
    groupResourcesByEngagement = true,
    blocksMode = false,
  } = preferences;
  // ONE i18n read per build for the placeholder label: the sort below calls the display name
  // O(n log n) times and every placeholder resolves the same word. Per BUILD CALL, never module
  // scope — a Paraglide message must be called at use time so it follows the active locale.
  const placeholderLabel = placeholderDisplayName();
  const displayNameOf = (r: Resource): string => (r.kind === "placeholder" ? placeholderLabel : resourceDisplayName(r));
  const byFavouriteResourceDisplayName = favouriteDisplayNameComparator<Resource>(displayNameOf);
  const byEngagementFavouriteResourceDisplayName = engagementFavouriteDisplayNameComparator<Resource>(displayNameOf);
  const byResourceDisplayName = displayNameComparator<Resource>(displayNameOf);
  const allocationFilters = createAllocationFilters(filters, preferences, data);
  const { resourceVisible } = allocationFilters;
  // Group allocations / time off by resource ONCE up front, so building each row
  // is a Map lookup instead of a full-array scan per resource (was O(resources ×
  // (allocations + timeOff)); now O(allocations + timeOff + resources)).
  const seriesEndByKey = new Map<string, ISODate>();
  const allocsByResource = groupByResourceId(data.allocations, {
    visit: (allocation) => {
      if (!allocation.seriesId || !isValidISODate(allocation.endDate)) return;
      const key = `${allocation.accountId}\u0000${allocation.seriesId}`;
      const current = seriesEndByKey.get(key);
      if (!current || allocation.endDate > current) {
        seriesEndByKey.set(key, allocation.endDate);
      }
    },
  });
  const personalTimeOff = data.timeOff.filter(hasRenderableDateRange);
  const closures = data.closures.filter(hasRenderableDateRange);
  const timeOffByResource = groupByResourceId(personalTimeOff);

  const capacitySource = createCapacitySource(days, visibleWindow, overSoonWindow, closures, blocksMode);
  const buildRow = createRowBuilder(
    { data, geom, days },
    accountWorkingDays,
    blocksMode,
    laneLayout,
    allocsByResource,
    timeOffByResource,
    seriesEndByKey,
    allocationFilters,
    capacitySource,
  );

  const fallbackGroups = (resources: Resource[]): SchedulerResourceGroup[] => {
    if (!groupResourcesByEngagement) {
      return resources.length ? [{ key: "unassigned", title: "Unassigned", discipline: null, resources }] : [];
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
  };

  // Assigned resources retain canonical discipline order. Every unassigned capacity-tracked row
  // then receives a useful engagement home; with disciplines off, that fallback becomes the whole
  // capacity grouping. External / 3rd party is deliberately appended last in both modes.
  const groups: SchedulerResourceGroup[] = [];
  if (disciplinesEnabled) {
    const disciplineGroups = resourcesByDiscipline(data);
    for (const group of disciplineGroups) {
      if (group.discipline) {
        groups.push({
          ...group,
          key: group.discipline.id,
          title: group.discipline.name,
          color: group.discipline.color,
        });
      }
    }
    const unassigned = disciplineGroups.find((group) => !group.discipline && !group.external)?.resources ?? [];
    groups.push(...fallbackGroups(unassigned));
  } else {
    groups.push(...fallbackGroups(data.resources.filter(isCapacityTracked)));
  }
  const external = externalBand(data.resources);
  if (external) {
    groups.push({
      ...external,
      key: "external",
      title: "External / 3rd party",
      color: NEUTRAL_COLOR,
    });
  }
  return groups
    .map((group) => ({
      key: group.key,
      title: group.title,
      color: group.color,
      external: !!group.external,
      // Keep discipline/external grouping intact. People are Studio then Supplementary when the
      // default-on account preference is enabled, with favourites first alphabetically inside each
      // partition. Placeholders remain after all people and have no favourite affordance.
      rows: group.resources
        .filter(resourceVisible)
        .sort(
          (a, b) =>
            Number(a.kind === "placeholder") - Number(b.kind === "placeholder") ||
            (a.kind === "placeholder"
              ? byResourceDisplayName(a, b)
              : groupResourcesByEngagement
                ? byEngagementFavouriteResourceDisplayName(a, b)
                : byFavouriteResourceDisplayName(a, b)),
        )
        .map(buildRow)
        // Non-matching rows are hidden by default; the "Show unallocated" toggle opts
        // the dimmed staffing view back in.
        .filter((row) => filters.showUnmatched || !row.dimmed),
    }))
    .filter((g) => g.rows.length > 0);
}
