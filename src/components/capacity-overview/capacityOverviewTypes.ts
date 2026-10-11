import type { AppData, Closure, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";
import type { CapacityOverviewHorizon, CapacityOverviewPeriod } from "./capacityOverviewDates";

/** Describes the capacity overview state used by this module. */
export type CapacityOverviewState = "available" | "fully-booked" | "unavailable" | "unassigned";

/** Describes the capacity overview period result used by this module. */
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

/** Renders the capacity overview row interface. */
export interface CapacityOverviewRow {
  resource: Resource;
  periods: CapacityOverviewPeriodResult[];
}

/** Renders the capacity overview group interface. */
export interface CapacityOverviewGroup {
  key: string;
  title: string;
  color?: string;
  rows: CapacityOverviewRow[];
}

/** Describes the capacity overview model used by this module. */
export interface CapacityOverviewModel {
  measured: boolean;
  reason?: "blocks-mode";
  periods: CapacityOverviewPeriod[];
  groups: CapacityOverviewGroup[];
}

/** Builds capacity overview model input from the supplied inputs. */
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
