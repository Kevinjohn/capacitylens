import { getInternalClient } from '@capacitylens/shared/data/internalClient'
import { resolveBarColor } from '@capacitylens/shared/lib/color'
import { hasRangeOverlap } from '@capacitylens/shared/lib/dateMath'
import {
  hasHourlyLoad,
  isCapacityTracked,
  isExternalResource,
} from '@capacitylens/shared/types/entities'
import type {
  Activity,
  Allocation,
  AppData,
  Client,
  ID,
  ISODate,
  Project,
  Resource,
  SchedulingMode,
} from '@capacitylens/shared/types/entities'
import { buildAllocationAttribution } from '@/lib/buildAllocationAttribution'
import { hasRenderableDateRange } from '@/lib/renderableDateRanges'
import type {
  PersonScheduleBuildResult,
  PersonScheduleEntry,
  PersonScheduleInvalidRecord,
  PersonScheduleWindow,
} from './personScheduleTypes'

/** Scoped scheduling data and visible window needed for a person projection. */
export interface BuildPersonScheduleInput {
  companyId: ID
  resource: Resource
  data: AppData
  window: PersonScheduleWindow
  schedulingMode: SchedulingMode
  showTaskFieldInSchedule: boolean
  canSeeTimeOffNotes: boolean
  title: string
  activityFallback: string
}

interface PersonScheduleLookups {
  activitiesById: Map<ID, Activity>
  projectsById: Map<ID, Project>
  clientsById: Map<ID, Client>
  internalClient: Client | undefined
  colorMaps: Parameters<typeof resolveBarColor>[1]
  seriesEndByKey: Map<string, ISODate>
}

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareEntries(left: PersonScheduleEntry, right: PersonScheduleEntry): number {
  return (
    compareText(left.startDate, right.startDate) ||
    compareText(left.endDate, right.endDate) ||
    compareText(left.kind, right.kind) ||
    compareText(left.sourceId, right.sourceId)
  )
}

function createPersonScheduleLookups(input: BuildPersonScheduleInput): PersonScheduleLookups {
  const activitiesById = new Map(input.data.activities.map((row) => [row.id, row]))
  const projectsById = new Map(input.data.projects.map((row) => [row.id, row]))
  const clientsById = new Map(input.data.clients.map((row) => [row.id, row]))
  return {
    activitiesById,
    projectsById,
    clientsById,
    internalClient: getInternalClient(input.data.clients, input.companyId),
    colorMaps: {
      activities: activitiesById,
      projects: projectsById,
      clients: clientsById,
      resources: new Map(input.data.resources.map((row) => [row.id, row])),
    },
    seriesEndByKey: new Map(),
  }
}

function collectSeriesMetadata(
  allocations: Allocation[],
  companyId: ID,
  seriesEndByKey: Map<string, ISODate>
): PersonScheduleInvalidRecord[] {
  const invalidRecords: PersonScheduleInvalidRecord[] = []
  for (const allocation of allocations) {
    if (allocation.companyId !== companyId) continue
    if (!hasRenderableDateRange(allocation)) {
      invalidRecords.push({ kind: 'allocation', sourceId: allocation.id })
      continue
    }
    if (!allocation.seriesId) continue
    const key = `${allocation.companyId}\u0000${allocation.seriesId}`
    const current = seriesEndByKey.get(key)
    if (current === undefined || allocation.endDate > current) {
      seriesEndByKey.set(key, allocation.endDate)
    }
  }
  return invalidRecords
}

function isOverlappingWindow(
  row: { startDate: ISODate; endDate: ISODate },
  window: PersonScheduleWindow
): boolean {
  return hasRangeOverlap(row.startDate, row.endDate, window.startDate, window.endDate)
}

function buildAllocationEntry(
  allocation: Allocation,
  input: BuildPersonScheduleInput,
  context: PersonScheduleLookups
): PersonScheduleEntry {
  const activity = context.activitiesById.get(allocation.activityId)
  const { project, client } = buildAllocationAttribution({
    allocation,
    activitiesById: context.activitiesById,
    projectsById: context.projectsById,
    clientsById: context.clientsById,
    internalClient: context.internalClient,
  })
  const seriesEnd = allocation.seriesId
    ? context.seriesEndByKey.get(`${allocation.companyId}\u0000${allocation.seriesId}`)
    : undefined
  return {
    kind: 'allocation',
    key: `allocation:${allocation.id}`,
    sourceId: allocation.id,
    startDate: allocation.startDate,
    endDate: allocation.endDate,
    activity: activity?.name ?? input.activityFallback,
    color: resolveBarColor(allocation, context.colorMaps),
    status: allocation.status,
    ...(project ? { project: project.name } : {}),
    ...(client ? { client: client.name } : {}),
    ...(hasHourlyLoad(input.schedulingMode) && !isExternalResource(input.resource)
      ? { hoursPerDay: allocation.hoursPerDay }
      : {}),
    ...(seriesEnd ? { seriesEnd } : {}),
    ...(input.showTaskFieldInSchedule && allocation.task ? { task: allocation.task } : {}),
    ...(allocation.note ? { note: allocation.note } : {}),
  }
}

function listAllocationEntries(
  input: BuildPersonScheduleInput,
  context: PersonScheduleLookups
): PersonScheduleEntry[] {
  const entries: PersonScheduleEntry[] = []
  for (const allocation of input.data.allocations) {
    if (allocation.companyId !== input.companyId || allocation.resourceId !== input.resource.id) {
      continue
    }
    if (!hasRenderableDateRange(allocation) || !isOverlappingWindow(allocation, input.window)) {
      continue
    }
    entries.push(buildAllocationEntry(allocation, input, context))
  }
  return entries
}

function listTimeOffEntries(input: BuildPersonScheduleInput): {
  entries: PersonScheduleEntry[]
  invalidRecords: PersonScheduleInvalidRecord[]
} {
  const entries: PersonScheduleEntry[] = []
  const invalidRecords: PersonScheduleInvalidRecord[] = []
  for (const timeOff of input.data.timeOff) {
    if (timeOff.companyId !== input.companyId || timeOff.resourceId !== input.resource.id) continue
    if (!hasRenderableDateRange(timeOff)) {
      invalidRecords.push({ kind: 'timeOff', sourceId: timeOff.id })
      continue
    }
    if (!isCapacityTracked(input.resource) || !isOverlappingWindow(timeOff, input.window)) continue
    entries.push({
      kind: 'timeOff',
      key: `timeOff:${timeOff.id}`,
      sourceId: timeOff.id,
      startDate: timeOff.startDate,
      endDate: timeOff.endDate,
      type: timeOff.type,
      ...(input.canSeeTimeOffNotes && timeOff.note ? { note: timeOff.note } : {}),
    })
  }
  return { entries, invalidRecords }
}

/** Projects one resource's allocations and time off into dated schedule entries. */
export function buildPersonSchedule(input: BuildPersonScheduleInput): PersonScheduleBuildResult {
  const context = createPersonScheduleLookups(input)
  const allocationInvalidRecords = collectSeriesMetadata(
    input.data.allocations,
    input.companyId,
    context.seriesEndByKey
  )
  const timeOff = listTimeOffEntries(input)
  const entries = [...listAllocationEntries(input, context), ...timeOff.entries].sort(
    compareEntries
  )
  return {
    model: {
      companyId: input.companyId,
      resourceId: input.resource.id,
      title: input.title,
      window: input.window,
      entries,
    },
    invalidRecords: [...allocationInvalidRecords, ...timeOff.invalidRecords],
  }
}
