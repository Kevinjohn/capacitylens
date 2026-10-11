import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { ISODate, Resource, SchedulingMode } from "@capacitylens/shared/types/entities";
/** Describes the allocation modal props used by this module. */
export type AllocationModalProps =
  | { kind: "edit"; allocationId: string; onClose: () => void }
  | {
      kind: "create";
      create: { resourceId: string; startDate: ISODate; endDate: ISODate };
      onClose: () => void;
    };

/** Renders the effective allocation input interface. */
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
