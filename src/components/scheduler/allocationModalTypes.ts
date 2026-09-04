import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { ISODate, Resource, SchedulingMode } from "@capacitylens/shared/types/entities";
export type AllocationModalProps =
  | { allocationId: string; onClose: () => void }
  | {
      create: { resourceId: string; startDate: ISODate; endDate: ISODate };
      onClose: () => void;
    };

export interface EffectiveAllocationInput {
  resource: Resource | undefined;
  effectiveWeek: EffectiveWorkingWeek | null;
  mode: SchedulingMode;
  startDate: ISODate;
  endDate: ISODate;
  hoursPerDay: number;
  daysOver: number;
  daysOfWork: number;
  ignoreWeekends: boolean;
}
