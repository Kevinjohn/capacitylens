import type { AllocationStatus, ID, ISODate, TimeOffType } from "@capacitylens/shared/types/entities";

/** Inclusive date bounds for a person schedule projection. */
export interface PersonScheduleWindow {
  startDate: ISODate;
  endDate: ISODate;
}

/** Stable key namespace distinguishes allocations from time-off entries. */
export type PersonScheduleEntryKey = `allocation:${ID}` | `timeOff:${ID}`;

interface PersonScheduleEntryBase {
  key: PersonScheduleEntryKey;
  sourceId: ID;
  startDate: ISODate;
  endDate: ISODate;
}

/** Allocation details presented as one dated person schedule entry. */
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

/** Time-off details presented as one dated person schedule entry. */
export interface PersonScheduleTimeOffEntry extends PersonScheduleEntryBase {
  kind: "timeOff";
  type: TimeOffType;
  note?: string;
}

/** A dated allocation or time-off entry in a person schedule. */
export type PersonScheduleEntry = PersonScheduleAllocationEntry | PersonScheduleTimeOffEntry;

/** Account, resource, window, and entries in an available person schedule. */
export interface PersonScheduleModel {
  accountId: ID;
  resourceId: ID;
  title: string;
  window: PersonScheduleWindow;
  entries: PersonScheduleEntry[];
}

/** A rejected entry and its kind for projection diagnostics. */
export interface PersonScheduleInvalidRecord {
  kind: PersonScheduleEntry["kind"];
  sourceId: ID;
}

/** Projected model plus any invalid records encountered while building it. */
export interface PersonScheduleBuildResult {
  model: PersonScheduleModel;
  invalidRecords: PersonScheduleInvalidRecord[];
}

/** Distinguishes an available projection from an unavailable schedule. */
export type PersonScheduleResult = { kind: "available"; model: PersonScheduleModel } | { kind: "unavailable" };

/** Open state, projected schedule, and closure callbacks for the sheet. */
export interface PersonScheduleSheetProps {
  open: boolean;
  schedule: PersonScheduleResult;
  onOpenChange: (open: boolean) => void;
  onRestoreFocus: () => void;
}
