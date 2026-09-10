import type { AllocationStatus, ID, ISODate, TimeOffType } from "@capacitylens/shared/types/entities";

export interface PersonScheduleWindow {
  startDate: ISODate;
  endDate: ISODate;
}

export type PersonScheduleEntryKey = `allocation:${ID}` | `timeOff:${ID}`;

interface PersonScheduleEntryBase {
  key: PersonScheduleEntryKey;
  sourceId: ID;
  startDate: ISODate;
  endDate: ISODate;
}

export interface PersonScheduleAllocationEntry extends PersonScheduleEntryBase {
  kind: "allocation";
  activity: string;
  color: string;
  status: AllocationStatus;
  project?: string;
  client?: string;
  hoursPerDay?: number;
  seriesEnd?: ISODate;
  note?: string;
}

export interface PersonScheduleTimeOffEntry extends PersonScheduleEntryBase {
  kind: "timeOff";
  type: TimeOffType;
  note?: string;
}

export type PersonScheduleEntry = PersonScheduleAllocationEntry | PersonScheduleTimeOffEntry;

export interface PersonScheduleModel {
  accountId: ID;
  resourceId: ID;
  title: string;
  window: PersonScheduleWindow;
  entries: PersonScheduleEntry[];
}

export interface PersonScheduleInvalidRecord {
  kind: PersonScheduleEntry["kind"];
  sourceId: ID;
}

export interface PersonScheduleBuildResult {
  model: PersonScheduleModel;
  invalidRecords: PersonScheduleInvalidRecord[];
}

export type PersonScheduleResult = { kind: "available"; model: PersonScheduleModel } | { kind: "unavailable" };

export interface PersonScheduleSheetProps {
  open: boolean;
  schedule: PersonScheduleResult;
  onOpenChange: (open: boolean) => void;
  onRestoreFocus: () => void;
}
