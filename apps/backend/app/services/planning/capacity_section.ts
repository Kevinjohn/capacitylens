import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays';
import { applyCapacityMode, buildDayCapacity } from '@capacitylens/shared/lib/capacity';
import { addDaysISO, eachDayISO, startOfWeekISO } from '@capacitylens/shared/lib/dateMath';
import { effectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { isCapacityTracked } from '@capacitylens/shared/types/entities';
import type { Account, Allocation, AppData, ISODate } from '@capacitylens/shared/types/entities';

/** Days the scheduler keeps before the current week's start (the browser's `PAST_BUFFER_DAYS`). */
const WINDOW_PAST_DAYS = 28;
/** Days the scheduler materialises: the past buffer plus the browser's `DEFAULT_RANGE_DAYS`. */
const WINDOW_DAYS = 148;
/** `overSoon` covers today and the 13 days after it, whatever window is read. */
const OVER_SOON_DAYS = 14;
/** The Capacity Overview's longest horizon: the current week and the 11 after it. */
const HORIZON_WEEKS = 12;

/** An inclusive date range. */
export interface CapacityRange {
  from: ISODate;
  to: ISODate;
}

/** One resource's figures over a range, one entry per date from `from` to `to`. */
export interface CapacityDays {
  allocated: number[];
  /** Allocated hours with tentative allocations left out. */
  confirmedAllocated: number[];
  available: number[];
  over: boolean[];
}

/** One capacity-tracked resource's figures. */
export interface ResourceCapacity {
  /** Whether a day from today to today + 13 is over capacity. */
  overSoon: boolean;
  window: CapacityDays;
  horizon: CapacityDays;
}

/** Per-day capacity for every capacity-tracked resource, computed by the server. */
export interface CapacitySection {
  /** The scheduler's materialised window. */
  window: CapacityRange;
  /** Today to the end of the Capacity Overview's 12-week horizon. */
  horizon: CapacityRange;
  /** Keyed by resource id; external parties have no entry. */
  resources: Record<string, ResourceCapacity>;
}

interface BuildCapacitySectionInput {
  /** The active rows the reader receives. */
  data: AppData;
  account: Account | undefined;
  today: ISODate;
  /** The requested window; the scheduler's default window when absent. */
  window?: CapacityRange | undefined;
}

/** The window the scheduler materialises for today: four weeks before the current week, 148 days. */
export function defaultCapacityWindow(today: ISODate, weekStartsOn: 0 | 1): CapacityRange {
  const from = addDaysISO(startOfWeekISO(today, weekStartsOn), -WINDOW_PAST_DAYS);
  return { from, to: addDaysISO(from, WINDOW_DAYS - 1) };
}

function groupByResource<T extends { resourceId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.resourceId);
    if (list) list.push(row);
    else grouped.set(row.resourceId, [row]);
  }
  return grouped;
}

/** Computes the planning read's capacity section with the shared capacity rules. */
export function buildCapacitySection({
  data,
  account,
  today,
  window,
}: BuildCapacitySectionInput): CapacitySection {
  const weekStartsOn = account?.weekStartsOn ?? 1;
  const accountWorkingDays = normalizeAccountWorkingDays(account?.workingDays, weekStartsOn);
  const blocksMode = account?.schedulingMode === 'blocks';
  const range = window ?? defaultCapacityWindow(today, weekStartsOn);
  const horizon = {
    from: today,
    to: addDaysISO(startOfWeekISO(today, weekStartsOn), HORIZON_WEEKS * 7 - 1),
  };
  const windowDates = eachDayISO(range.from, range.to);
  const horizonDates = eachDayISO(horizon.from, horizon.to);
  const overSoonDates = eachDayISO(today, addDaysISO(today, OVER_SOON_DAYS - 1));
  const allocationsByResource = groupByResource(data.allocations);
  const timeOffByResource = groupByResource(data.timeOff);

  const resources: Record<string, ResourceCapacity> = {};
  for (const resource of data.resources.filter(isCapacityTracked)) {
    const allocations = applyCapacityMode({
      allocations: allocationsByResource.get(resource.id) ?? [],
      blocksMode,
    });
    const confirmed = allocations.filter((allocation) => allocation.status !== 'tentative');
    const timeOff = timeOffByResource.get(resource.id) ?? [];
    const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
    const dayOn = (date: ISODate, rows: Allocation[]) =>
      buildDayCapacity({
        resource,
        date,
        allocations: rows,
        timeOff,
        effectiveWeek,
        closures: data.closures,
      });
    // The three ranges overlap, so each date is computed once.
    const memo = new Map<ISODate, { day: ReturnType<typeof dayOn>; confirmed: number }>();
    const figuresOn = (date: ISODate) => {
      const cached = memo.get(date);
      if (cached) return cached;
      const day = dayOn(date, allocations);
      const figures = {
        day,
        confirmed:
          confirmed.length === allocations.length
            ? day.allocated
            : dayOn(date, confirmed).allocated,
      };
      memo.set(date, figures);
      return figures;
    };
    const daysOver = (dates: ISODate[]): CapacityDays => {
      const figures = dates.map(figuresOn);
      return {
        allocated: figures.map(({ day }) => day.allocated),
        confirmedAllocated: figures.map(({ confirmed: hours }) => hours),
        available: figures.map(({ day }) => day.available),
        over: figures.map(({ day }) => day.over),
      };
    };
    resources[resource.id] = {
      overSoon: overSoonDates.some((date) => figuresOn(date).day.over),
      window: daysOver(windowDates),
      horizon: daysOver(horizonDates),
    };
  }
  return { window: range, horizon, resources };
}
