import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type {
  Activity,
  Allocation,
  AllocationStatus,
  AppData,
  ISODate,
  Resource,
  SchedulingMode,
} from "@capacitylens/shared/types/entities";
import type { RepeatSelection } from "../../lib/repeatingAllocations";
import type { AllocationModalProps } from "./allocationModalTypes";

/** Current form values consumed by pure projections and the command factory. */
export interface AllocationModalSnapshot {
  data: AppData;
  create: Extract<AllocationModalProps, { create: unknown }>["create"] | undefined;
  editing: Allocation | undefined;
  editId: string | undefined;
  mode: SchedulingMode;
  resourceId: string;
  activityId: string;
  selectedResource: Resource | undefined;
  selectedActivity: Activity | undefined;
  selectedEffectiveProjectId: string | undefined;
  attributedProjectId: string | undefined;
  selectedEffectiveWeek: EffectiveWorkingWeek | null;
  startDate: ISODate;
  endDate: ISODate;
  effEndDate: ISODate;
  hoursPerDay: number;
  effHoursPerDay: number;
  daysOver: number;
  initialDaysOver: number;
  daysOfWork: number;
  ignoreWeekends: boolean;
  status: AllocationStatus;
  note: string;
  noteEdited: boolean;
  repeat: RepeatSelection;
  repeatUntil: string;
  repeatToday: ISODate;
  repeatUntilMinimum: ISODate;
  repeatUntilMaximum: ISODate | undefined;
  isBlocks: boolean;
  isDays: boolean;
  isExternal: boolean;
  usesTypedDateRange: boolean;
  typedDateSpanTooLong: boolean;
  validDaysOver: boolean;
  spanFitsDateDomain: boolean;
  spanLimitedByDateDomain: boolean;
  maximumDaysOver: number;
}
