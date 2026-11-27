import type { EffectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek'
import type {
  Activity,
  Allocation,
  AllocationStatus,
  AppData,
  ISODate,
  Resource,
  SchedulingMode,
} from '@capacitylens/shared/types/entities'
import type { RepeatSelection } from '@/lib/repeatingAllocations'

/** Creation and editing variants for the allocation dialog. */
export type AllocationDialogProps =
  | { kind: 'edit'; allocationId: string; onClose: () => void }
  | {
      kind: 'create'
      create: { resourceId: string; startDate: ISODate; endDate: ISODate }
      onClose: () => void
    }

/** Resolved resource, working week and scheduling inputs used to derive effective allocation values. */
export interface EffectiveAllocationInput {
  resource: Resource | undefined
  effectiveWeek: EffectiveWorkingWeek | undefined
  mode: SchedulingMode
  startDate: ISODate
  endDate: ISODate
  hoursPerDay: number
  daysOver: number
  daysOfWork: number
  ignoreWorkingDays: boolean
}

/** Current form values consumed by pure projections and the command factory. */
export interface AllocationDialogSnapshot {
  /** Only the tables the seed and submit projections read. */
  data: Pick<AppData, 'activities' | 'allocations' | 'closures' | 'timeOff'>
  create: Extract<AllocationDialogProps, { create: unknown }>['create'] | undefined
  editing: Allocation | undefined
  mode: SchedulingMode
  resourceId: string
  activityId: string
  selectedResource: Resource | undefined
  selectedActivity: Activity | undefined
  selectedEffectiveProjectId: string | undefined
  attributedProjectId: string | undefined
  selectedEffectiveWeek: EffectiveWorkingWeek | undefined
  startDate: ISODate
  endDate: ISODate
  effEndDate: ISODate
  hoursPerDay: number
  effHoursPerDay: number
  daysOver: number
  initialDaysOver: number
  daysOfWork: number
  ignoreWorkingDays: boolean
  status: AllocationStatus
  note: string
  noteEdited: boolean
  task: string
  repeat: RepeatSelection
  repeatUntil: string
  repeatToday: ISODate
  repeatUntilMinimum: ISODate
  repeatUntilMaximum: ISODate | undefined
  isBlocks: boolean
  isDays: boolean
  isExternal: boolean
  usesTypedDateRange: boolean
  typedDateSpanTooLong: boolean
  validDaysOver: boolean
  spanFitsDateDomain: boolean
  spanLimitedByDateDomain: boolean
  maximumDaysOver: number
}
