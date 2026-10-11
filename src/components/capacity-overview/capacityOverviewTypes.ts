import type { AppData, Closure, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";
import type { CapacityOverviewHorizon, CapacityOverviewPeriod } from "./capacityOverviewDates";

/** Availability categories displayed for a resource in one period. */
export type CapacityOverviewState = "available" | "fully-booked" | "unavailable" | "unassigned";

/** Capacity result and display state for one overview period. */
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

/** A resource and its capacity results across visible periods. */
export interface CapacityOverviewRow {
  resource: Resource;
  periods: CapacityOverviewPeriodResult[];
}

/** A labelled group of resource rows in the overview. */
export interface CapacityOverviewGroup {
  key: string;
  title: string;
  color?: string;
  rows: CapacityOverviewRow[];
}

/** Measured periods and resource groups consumed by the view. */
export interface CapacityOverviewModel {
  measured: boolean;
  reason?: "blocks-mode";
  periods: CapacityOverviewPeriod[];
  groups: CapacityOverviewGroup[];
}

/** Scoped data and display preferences needed for capacity projection. */
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
  blocksMode?: boolean;
  /** Narrowed test/read projections may pass these arrays explicitly; data remains the default. */
  timeOff?: TimeOff[];
  closures?: Closure[];
}
