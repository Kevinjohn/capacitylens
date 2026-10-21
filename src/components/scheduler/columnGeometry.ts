import { dayIndex, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { DAY_COLUMN_MIN_WIDTH, WEEKDAY_LABEL_MIN_WIDTH } from "@/lib/schedulerConfig";
import type { ISODate } from "@capacitylens/shared/types/entities";

// Shared pure geometry keeps bars, headers, pointer mapping and drag previews on the same pixel/date boundaries, including narrowed weekends. Unexpected math errors must remain visible rather than be caught here.

/** Per-column geometry for one aligned visible-date window. Build once per geometry change; indexed width/offset reads are constant-time and pixel-to-column lookup is logarithmic. */
export interface ColumnGeometry {
  /** widths[i] = px width of visible day i. */
  readonly widths: number[];
  /** Prefix-summed left edges, length n+1: offsets[i] = left edge of day i, offsets[n] = totalWidth. */
  readonly offsets: number[];
  /** Total px width of the whole window (= offsets[n]). */
  readonly totalWidth: number;
  /** Cached numeric weekdays align with visible column widths so row rendering does not reparse the same date for every resource. */
  readonly weekdays: number[];
  /** One shared zoom threshold enables daily headers and row decorations so those surfaces switch together. */
  readonly perDayColumns: boolean;
  /** True at/above `WEEKDAY_LABEL_MIN_WIDTH`: the columns have room for the weekday letters
   * (Mon/Tue…) on top of the date number. Implies {@link perDayColumns}. */
  readonly showWeekdayLabels: boolean;
  /** True when weekends are actually being narrowed (the pref is on and the zoom is fine
   * enough that per-day columns render). The header keys its "S" weekend label off this. */
  readonly minimiseActive: boolean;
  /** Left edge px of column `index`, clamped to [0, n] (so an out-of-range index pins to an edge). */
  x(index: number): number;
  /** Width px of column `index` (0 when out of range). */
  widthOf(index: number): number;
  /** Px width spanning columns [startIdx, endIdx] inclusive (≥ 0; 0 when reversed). */
  spanWidth(startIndex: number, endIndex: number): number;
  /** Inverse of {@link x}: a lane-relative pointer x → day index, clamped to [0, n-1].
   * The exact inverse at boundaries: a click at offsets[i] → i, at offsets[i]-ε → i-1. */
  indexAt(px: number): number;
  /** {@link indexAt} for a container's `scrollLeft`: it rounds first. Every scroll-position read
   * must go through this rather than `indexAt` directly; see resolveWeekStartSnapTarget.ts's
   * "Sub-pixel rounding" note for the full rationale. A HiDPI browser can store scrollLeft a
   * fraction below an integer column boundary, and indexAt's strict floor would resolve that to the
   * previous column, which under minimised weekends is much narrower. */
  indexAtScroll(scrollLeft: number): number;
  /** Returns a date's pixel edge, extrapolating full-width columns outside the visible window and returning zero for invalid dates. */
  xForDateInGeom(date: ISODate): number;
  /** Px width of the inclusive date range [start, end] (≥ 0; 0 when reversed or unparseable). */
  widthForDates(start: ISODate, end: ISODate): number;
}

/** Weekend-width preference used when building date column offsets. */
export interface ColumnGeometryOptions {
  /** The device-global "Minimise weekends" pref. */
  minimiseWeekends: boolean;
  /** Resolved px width for a narrowed weekend column (e.g. WEEKEND_COLUMN_REM × root font px). */
  weekendWidth: number;
  /** Integer width assigned to every calendar week by the viewport fit. Any pixels left after
   * the base day/weekend widths are spread across individual columns, keeping integer offsets. */
  targetWeekWidth?: number;
}

function requireDenseValue<T>(values: T[], index: number, invariant: string): T {
  const value = values[index];
  if (value === undefined) throw new Error(invariant);
  return value;
}

interface ColumnMeasurements {
  widths: number[];
  offsets: number[];
  weekdays: number[];
  totalWidth: number;
}

interface ColumnWidthInput {
  weekday: number;
  dayWidth: number;
  narrowWidth: number;
  extraPixels: number;
  minimiseActive: boolean;
}

function resolveExtraPixels(dayWidth: number, narrowWidth: number, options: ColumnGeometryOptions): number {
  const minimiseActive = options.minimiseWeekends && dayWidth >= DAY_COLUMN_MIN_WIDTH;
  const baseWeekWidth = minimiseActive ? 5 * dayWidth + 2 * narrowWidth : 7 * dayWidth;
  const requestedWeekWidth = Math.round(options.targetWeekWidth ?? baseWeekWidth);
  const availableExtra = Number.isFinite(requestedWeekWidth) ? requestedWeekWidth - baseWeekWidth : 0;
  const maximumExtra = minimiseActive ? 5 : 7;
  return Math.min(maximumExtra, Math.max(0, availableExtra));
}

function resolveColumnWidth(input: ColumnWidthInput): number {
  const isWeekend = input.weekday === 0 || input.weekday === 6;
  if (input.minimiseActive && isWeekend) return input.narrowWidth;
  let receivesExtra = input.weekday < input.extraPixels;
  if (input.minimiseActive) receivesExtra = input.weekday > 0 && input.weekday - 1 < input.extraPixels;
  return input.dayWidth + (receivesExtra ? 1 : 0);
}

function buildColumnMeasurements(
  days: ISODate[],
  dayWidth: number,
  options: ColumnGeometryOptions,
): ColumnMeasurements {
  const dayCount = days.length;
  const minimiseActive = options.minimiseWeekends && dayWidth >= DAY_COLUMN_MIN_WIDTH;
  const rawNarrow = Math.round(Math.min(options.weekendWidth, dayWidth));
  const narrowWidth = Number.isFinite(rawNarrow) && rawNarrow > 0 ? rawNarrow : dayWidth;
  const extraPixels = resolveExtraPixels(dayWidth, narrowWidth, options);
  const widths = new Array<number>(dayCount);
  const offsets = new Array<number>(dayCount + 1);
  const weekdays = new Array<number>(dayCount);
  offsets[0] = 0;

  for (let index = 0; index < dayCount; index++) {
    const day = requireDenseValue(days, index, "Column geometry day window must be dense.");
    const weekday = weekdayOf(day);
    const width = resolveColumnWidth({ weekday, dayWidth, narrowWidth, extraPixels, minimiseActive });
    weekdays[index] = weekday;
    widths[index] = width;
    offsets[index + 1] = requireDenseValue(offsets, index, "Column geometry offsets must be dense.") + width;
  }

  const totalWidth = requireDenseValue(offsets, dayCount, "Column geometry offsets must align with the day window.");
  return { widths, offsets, weekdays, totalWidth };
}

interface GeometryAccessorsInput extends ColumnMeasurements {
  dayCount: number;
  dayWidth: number;
  origin: ISODate | undefined;
}

function createGeometryAccessors(
  input: GeometryAccessorsInput,
): Pick<
  ColumnGeometry,
  "indexAt" | "indexAtScroll" | "spanWidth" | "widthForDates" | "widthOf" | "x" | "xForDateInGeom"
> {
  const clampEdge = (index: number): number => {
    if (index < 0) return 0;
    if (index > input.dayCount) return input.dayCount;
    return index;
  };
  const xForDayIndex = (index: number): number => {
    if (index < 0) return index * input.dayWidth;
    if (index > input.dayCount) return input.totalWidth + (index - input.dayCount) * input.dayWidth;
    return requireDenseValue(input.offsets, index, "Column geometry offsets must align with the day window.");
  };
  const indexAt = (px: number): number => {
    if (input.dayCount === 0 || px <= 0) return 0;
    if (px >= input.totalWidth) return input.dayCount - 1;
    let lowerIndex = 0;
    let upperIndex = input.dayCount - 1;
    while (lowerIndex < upperIndex) {
      const middleIndex = (lowerIndex + upperIndex + 1) >> 1;
      if (requireDenseValue(input.offsets, middleIndex, "Column geometry offsets must be dense.") <= px)
        lowerIndex = middleIndex;
      else upperIndex = middleIndex - 1;
    }
    return lowerIndex;
  };
  const xForDateInGeom = (date: ISODate): number => {
    if (!input.origin) return 0;
    const index = dayIndex(date, input.origin);
    return Number.isFinite(index) ? xForDayIndex(index) : 0;
  };
  const widthForDates = (start: ISODate, end: ISODate): number => {
    if (!input.origin) return 0;
    const startIndex = dayIndex(start, input.origin);
    const endIndex = dayIndex(end, input.origin);
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return 0;
    return Math.max(0, xForDayIndex(endIndex + 1) - xForDayIndex(startIndex));
  };

  return {
    x: (index) => requireDenseValue(input.offsets, clampEdge(index), "Column geometry offsets must be dense."),
    widthOf: (index) => {
      if (index < 0 || index >= input.dayCount) return 0;
      return requireDenseValue(input.widths, index, "Column geometry widths must align with the day window.");
    },
    spanWidth: (startIndex, endIndex) =>
      Math.max(
        0,
        requireDenseValue(input.offsets, clampEdge(endIndex + 1), "Column geometry offsets must be dense.") -
          requireDenseValue(input.offsets, clampEdge(startIndex), "Column geometry offsets must be dense."),
      ),
    indexAt,
    indexAtScroll: (scrollLeft) => indexAt(Math.round(scrollLeft)),
    xForDateInGeom,
    widthForDates,
  };
}

/**
 * Build the column geometry for `days` at `dayWidth`.
 *
 * Weekends are only narrowed when `minimiseWeekends` is on and `dayWidth >= DAY_COLUMN_MIN_WIDTH`
 * (the per-day-column threshold): below it the header shows week blocks, so narrowing is both
 * meaningless and risky, `weekendWidth` could otherwise exceed `dayWidth` at extreme zoom-out.
 * A non-finite / non-positive `weekendWidth` degrades to no narrowing (full-width weekends), so
 * an unmeasured font size can never inject a NaN width into the prefix sum.
 */
export function buildColumnGeometry(days: ISODate[], dayWidth: number, options: ColumnGeometryOptions): ColumnGeometry {
  const dayCount = days.length;
  const perDayColumns = dayWidth >= DAY_COLUMN_MIN_WIDTH;
  const minimiseActive = options.minimiseWeekends && perDayColumns;
  // Round narrowed weekend widths to integer pixels and cap them at dayWidth so column offsets stay valid and zoom anchoring remains aligned.
  const measurements = buildColumnMeasurements(days, dayWidth, options);

  const origin = days[0];
  const accessors = createGeometryAccessors({ ...measurements, dayCount, dayWidth, origin });

  return {
    ...measurements,
    perDayColumns,
    showWeekdayLabels: dayWidth >= WEEKDAY_LABEL_MIN_WIDTH,
    minimiseActive,
    ...accessors,
  };
}

/**
 * Resolves the date at a scroll container's left edge through the shared rounded scroll inverse. Empty windows return undefined.
 *
 * @throws Error when non-empty dates and geometry are misaligned.
 */
export function resolveLeftEdgeDate(
  geometry: ColumnGeometry,
  days: ISODate[],
  scrollLeft: number,
): ISODate | undefined {
  if (days.length === 0) return undefined;
  const day = days[geometry.indexAtScroll(scrollLeft)];
  if (day === undefined) throw new Error("Column geometry index is outside the day window.");
  return day;
}
