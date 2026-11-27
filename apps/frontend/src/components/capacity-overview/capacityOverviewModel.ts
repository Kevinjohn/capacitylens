import type { CapacitySection } from '@capacitylens/shared/lib/capacity'
import { calculateDayIndex, listDaysISO } from '@capacitylens/shared/lib/dateMath'
import { isCapacityTracked, isPlaceholderResource } from '@capacitylens/shared/types/entities'
import type { AppData, Resource } from '@capacitylens/shared/types/entities'
import {
  buildEngagementGroups,
  buildResourceBand,
  createResourceComparator,
  isResourceKindEnabled,
} from '@/lib/resourceGrouping'
import type { ResourceBandGroup } from '@/lib/resourceGrouping'
import { buildDisciplineGroups, hasSupplementaryResources } from '@/store/selectors'
import type { CapacityOverviewPeriod } from './capacityOverviewDates'
import { buildCapacityOverviewPeriods } from './capacityOverviewDates'
import type {
  BuildCapacityOverviewModelInput,
  CapacityOverviewGroup,
  CapacityOverviewModel,
  CapacityOverviewState,
  CapacityOverviewPeriodResult,
} from './capacityOverviewTypes'
export type { CapacityOverviewHorizon, CapacityOverviewPeriod } from './capacityOverviewDates'
export type {
  BuildCapacityOverviewModelInput,
  CapacityOverviewGroup,
  CapacityOverviewModel,
  CapacityOverviewRow,
  CapacityOverviewState,
  CapacityOverviewPeriodResult,
} from './capacityOverviewTypes'

/** Hours represented by one capacity day in overview totals. */
export const HOURS_PER_DISPLAY_DAY = 8
const QUARTER_DAY_HOURS = HOURS_PER_DISPLAY_DAY / 4
const ROUNDING_EPSILON_HOURS = 1e-9

interface CalculatePeriodInput {
  resource: Resource
  period: CapacityOverviewPeriod
  capacity: CapacitySection | null
  includeTentative: boolean
}

interface BuildGroupSeedsInput {
  data: AppData
  eligible: Set<string>
  disciplinesEnabled: boolean
  groupByEngagement: boolean
}

/** Free capacity rounds down to the quarter-day so a printed figure never promises time that is not there. */
export function roundDownQuarterDays(hours: number): number {
  return Math.max(0, Math.floor((hours + ROUNDING_EPSILON_HOURS) / QUARTER_DAY_HOURS) / 4)
}

/** Demand and overload round up so a printed figure never hides a fraction of a booking. */
export function roundUpQuarterDays(hours: number): number {
  return Math.max(0, Math.ceil((hours - ROUNDING_EPSILON_HOURS) / QUARTER_DAY_HOURS) / 4)
}

function resolvePersonState(
  availableHours: number,
  freeDays: number
): Exclude<CapacityOverviewState, 'unassigned'> {
  if (availableHours === 0) return 'unavailable'
  return freeDays >= 0.25 ? 'available' : 'fully-booked'
}

function calculatePeriod({
  resource,
  period,
  capacity,
  includeTentative,
}: CalculatePeriodInput): CapacityOverviewPeriodResult {
  const days = capacity?.resources[resource.id]?.horizon
  let availableHours = 0
  let freeHours = 0
  let overHours = 0
  let tentativeHours = 0
  let unassignedDemandHours = 0
  for (const date of listDaysISO(period.start, period.end)) {
    // A date outside the server's horizon contributes nothing.
    const index = capacity ? calculateDayIndex(date, capacity.horizon.from) : -1
    const available = days?.available[index]
    const allAllocated = days?.allocated[index]
    const confirmed = days?.confirmedAllocated[index]
    if (available === undefined || allAllocated === undefined || confirmed === undefined) continue
    const allocated = includeTentative ? allAllocated : confirmed
    if (isPlaceholderResource(resource)) {
      unassignedDemandHours += allocated
      continue
    }
    const dayFree = Math.max(available - allocated, 0)
    availableHours += available
    freeHours += dayFree
    overHours += Math.max(allocated - available, 0)
    // Tentative work is measured as the free time it consumes: the free hours with confirmed work
    // only less the free hours with every allocation, so free + tentative never exceeds available.
    if (includeTentative) {
      tentativeHours += Math.max(Math.max(available - confirmed, 0) - dayFree, 0)
    }
  }
  const freeDays = roundDownQuarterDays(freeHours)
  const overDays = roundUpQuarterDays(overHours)
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
    state: isPlaceholderResource(resource)
      ? 'unassigned'
      : resolvePersonState(availableHours, freeDays),
  }
}

function buildGroupSeeds({
  data,
  eligible,
  disciplinesEnabled,
  groupByEngagement,
}: BuildGroupSeedsInput): ResourceBandGroup[] {
  const eligibleResources = data.resources.filter((resource) => eligible.has(resource.id))
  const placeholders = eligibleResources.filter(isPlaceholderResource)
  const people = eligibleResources.filter((resource) => !isPlaceholderResource(resource))
  const placeholderGroups = placeholders.length
    ? [{ ...buildResourceBand('placeholders'), resources: placeholders }]
    : []
  if (!disciplinesEnabled) {
    return [
      ...buildEngagementGroups({
        resources: people,
        groupByEngagement,
        ungrouped: buildResourceBand('overall'),
      }),
      ...placeholderGroups,
    ]
  }
  const groups: ResourceBandGroup[] = []
  for (const group of buildDisciplineGroups(data)) {
    if (group.external) continue
    const resources = group.resources.filter(
      (resource) => eligible.has(resource.id) && !isPlaceholderResource(resource)
    )
    if (!resources.length) continue
    if (group.discipline) {
      groups.push({
        key: group.discipline.id,
        title: group.discipline.name,
        ...(group.discipline.color ? { color: group.discipline.color } : {}),
        resources,
      })
    } else {
      groups.push(
        ...buildEngagementGroups({
          resources,
          groupByEngagement,
          ungrouped: buildResourceBand('unassigned'),
        })
      )
    }
  }
  return [...groups, ...placeholderGroups]
}

type IsEligibleResourceOptions = { resource: Resource; placeholdersEnabled: boolean }
function isEligibleResource({ resource, placeholdersEnabled }: IsEligibleResourceOptions): boolean {
  if (!isCapacityTracked(resource)) return false
  if (resource.archivedAt != null) return false
  // External parties have no capacity, so the overview never shows them whatever the company chose.
  return isResourceKindEnabled(resource, { placeholdersEnabled, externalEnabled: false })
}

function buildRows({
  seeds,
  periods,
  capacity,
  includeTentative,
  groupByEngagement,
}: {
  seeds: ResourceBandGroup[]
  periods: CapacityOverviewPeriod[]
  capacity: CapacitySection | null
  includeTentative: boolean
  groupByEngagement: boolean
}): CapacityOverviewGroup[] {
  const compareResources = createResourceComparator(groupByEngagement)
  return seeds.map((seed) => {
    const rows = seed.resources
      .slice()
      .sort(compareResources)
      .map((resource) => {
        const resourcePeriods = periods.map((period) =>
          calculatePeriod({ resource, period, capacity, includeTentative })
        )
        return { resource, periods: resourcePeriods }
      })
    return { ...seed, rows }
  })
}

type ApplyAvailabilityFilterOptions = { groups: CapacityOverviewGroup[]; hasAvailability: boolean }
function applyAvailabilityFilter({
  groups,
  hasAvailability,
}: ApplyAvailabilityFilterOptions): CapacityOverviewGroup[] {
  if (!hasAvailability) return groups
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        isPlaceholderResource(row.resource)
          ? row.periods.some((period) => period.unassignedDemandDays > 0)
          : row.periods.some((period) => period.freeDays >= 0.25)
      ),
    }))
    .filter((group) => group.rows.length > 0)
}

/** Projects scoped scheduling data into period and resource capacity results. */
export function buildCapacityOverviewModel({
  data,
  today,
  weekStartsOn = 1,
  horizon = '4-weeks',
  capacity,
  includeTentative = true,
  placeholdersEnabled = false,
  hasAvailability = false,
  disciplinesEnabled = true,
  blocksMode = false,
}: BuildCapacityOverviewModelInput): CapacityOverviewModel {
  const periods = buildCapacityOverviewPeriods({ today, weekStartsOn, horizon })
  if (blocksMode) {
    return { measured: false, reason: 'blocks-mode', periods, groups: [] }
  }

  const eligible = new Set(
    data.resources
      .filter((resource) => isEligibleResource({ resource, placeholdersEnabled }))
      .map((resource) => resource.id)
  )
  const groupByEngagement = hasSupplementaryResources(data.resources)
  const groups = buildRows({
    seeds: buildGroupSeeds({ data, eligible, disciplinesEnabled, groupByEngagement }),
    periods,
    capacity,
    includeTentative,
    groupByEngagement,
  })
  return {
    measured: true,
    periods,
    groups: applyAvailabilityFilter({ groups, hasAvailability }),
  }
}
