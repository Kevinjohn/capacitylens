import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { ISODate, Resource, SchedulingMode } from "@capacitylens/shared/types/entities";
/** Creation and editing variants for the allocation dialog. */
export type AllocationModalProps =
  | { kind: "edit"; allocationId: string; onClose: () => void }
  | {
      kind: "create";
      create: { resourceId: string; startDate: ISODate; endDate: ISODate };
      onClose: () => void;
    };

/** Resolved resource and attribution values needed before an allocation save. */
export interface EffectiveAllocationInput {
  resource: Resource | undefined;
  effectiveWeek: EffectiveWorkingWeek | undefined;
  mode: SchedulingMode;
  startDate: ISODate;
  endDate: ISODate;
  hoursPerDay: number;
  daysOver: number;
  daysOfWork: number;
  ignoreWeekends: boolean;
}
