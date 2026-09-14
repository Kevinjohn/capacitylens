import type { AppData, Closure, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";
import type { CapacityOverviewHorizon, CapacityOverviewPeriod } from "./capacityOverviewDates";

export type CapacityOverviewState = "available" | "fully-booked" | "unavailable" | "unassigned";

export interface CapacityOverviewPeriodResult {
  period: CapacityOverviewPeriod;
  /** Eight hours for each company working day in this column's date range. */
  companyWorkingHours: number;
  availableHours: number;
  allocatedHours: number;
  freeHours: number;
  overHours: number;
  freeDays: number;
  overDays: number;
  unassignedDemandHours: number;
  unassignedDemandDays: number;
  state: CapacityOverviewState;
}

export interface CapacityOverviewSummaryPeriod {
  availableHours: number;
  freeHours: number;
  overHours: number;
  freeDays: number;
  overDays: number;
  unassignedDemandHours: number;
  unassignedDemandDays: number;
}

export interface CapacityOverviewSummary {
  /** Summary values include every eligible person, even when rows are filtered from the table. */
  scope: "all-eligible-people";
  peopleCount: number;
  placeholderCount: number;
  periods: CapacityOverviewSummaryPeriod[];
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
  summary: CapacityOverviewSummary;
}

export interface CapacityOverviewModel {
  measured: boolean;
  reason?: "blocks-mode";
  periods: CapacityOverviewPeriod[];
  groups: CapacityOverviewGroup[];
  summary: CapacityOverviewSummary;
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
