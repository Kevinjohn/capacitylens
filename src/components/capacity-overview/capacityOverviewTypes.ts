import type { AppData, Closure, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";
import type { CapacityOverviewHorizon, CapacityOverviewPeriod } from "./capacityOverviewDates";

export type CapacityOverviewState = "available" | "fully-booked" | "unavailable" | "unassigned";

export interface CapacityOverviewPeriodResult {
  period: CapacityOverviewPeriod;
  availableHours: number;
  freeHours: number;
  overHours: number;
  /** Free hours that tentative allocations consume; zero when tentative work is excluded. */
  tentativeHours: number;
  freeDays: number;
  overDays: number;
  tentativeDays: number;
  unassignedDemandHours: number;
  unassignedDemandDays: number;
  state: CapacityOverviewState;
}

export interface CapacityOverviewRow {
  resource: Resource;
  periods: CapacityOverviewPeriodResult[];
}

export interface CapacityOverviewGroup {
  key: string;
  title: string;
  color?: string;
  rows: CapacityOverviewRow[];
}

export interface CapacityOverviewModel {
  measured: boolean;
  reason?: "blocks-mode";
  periods: CapacityOverviewPeriod[];
  groups: CapacityOverviewGroup[];
}

export interface BuildCapacityOverviewModelInput {
  data: AppData;
  today: ISODate;
  weekStartsOn?: 0 | 1;
  horizon?: CapacityOverviewHorizon;
  accountWorkingDays?: Weekday[];
  includeTentative?: boolean;
  placeholdersEnabled?: boolean;
  hasAvailability?: boolean;
  disciplinesEnabled?: boolean;
  groupResourcesByEngagement?: boolean;
  blocksMode?: boolean;
  /** Narrowed test/read projections may pass these arrays explicitly; data remains the default. */
  timeOff?: TimeOff[];
  closures?: Closure[];
}
