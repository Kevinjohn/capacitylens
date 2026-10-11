import type { AllocationStatus, ID, ISODate, TimeOffType } from "@capacitylens/shared/types/entities";

/** Renders the person schedule window interface. */
export interface PersonScheduleWindow {
  startDate: ISODate;
  endDate: ISODate;
}

/** Renders the person schedule entry key interface. */
export type PersonScheduleEntryKey = `allocation:${ID}` | `timeOff:${ID}`;

interface PersonScheduleEntryBase {
  key: PersonScheduleEntryKey;
  sourceId: ID;
  startDate: ISODate;
  endDate: ISODate;
}

/** Renders the person schedule allocation entry interface. */
export interface PersonScheduleAllocationEntry extends PersonScheduleEntryBase {
  kind: "allocation";
  activity: string;
  color: string;
  status: AllocationStatus;
  project?: string;
  client?: string;
  hoursPerDay?: number;
  seriesEnd?: ISODate;
  task?: string;
  note?: string;
}

/** Renders the person schedule time off entry interface. */
export interface PersonScheduleTimeOffEntry extends PersonScheduleEntryBase {
  kind: "timeOff";
  type: TimeOffType;
  note?: string;
}

/** Renders the person schedule entry interface. */
export type PersonScheduleEntry = PersonScheduleAllocationEntry | PersonScheduleTimeOffEntry;

/** Describes the person schedule model used by this module. */
export interface PersonScheduleModel {
  accountId: ID;
  resourceId: ID;
  title: string;
  window: PersonScheduleWindow;
  entries: PersonScheduleEntry[];
}

/** Renders the person schedule invalid record interface. */
export interface PersonScheduleInvalidRecord {
  kind: PersonScheduleEntry["kind"];
  sourceId: ID;
}

/** Describes the person schedule build result used by this module. */
export interface PersonScheduleBuildResult {
  model: PersonScheduleModel;
  invalidRecords: PersonScheduleInvalidRecord[];
}

/** Describes the person schedule result used by this module. */
export type PersonScheduleResult = { kind: "available"; model: PersonScheduleModel } | { kind: "unavailable" };

/** Describes the person schedule sheet props used by this module. */
export interface PersonScheduleSheetProps {
  open: boolean;
  schedule: PersonScheduleResult;
  onOpenChange: (open: boolean) => void;
  onRestoreFocus: () => void;
}
