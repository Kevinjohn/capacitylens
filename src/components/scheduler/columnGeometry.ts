import { dayIndex, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { DAY_COLUMN_MIN_WIDTH, WEEKDAY_LABEL_MIN_WIDTH } from "../../lib/schedulerConfig";
import type { ISODate } from "@capacitylens/shared/types/entities";

// The scheduler grid used to be a UNIFORM fixed-pixel grid: a single scalar `dayWidth`,
// every column the same width, so `x = index * dayWidth` and the inverse was a plain
// `Math.floor(px / dayWidth)`. The "minimise weekends" feature breaks that assumption —
// Sat/Sun columns shrink to a sliver — so this module replaces the scalar with a
// prefix-summed offsets array that lets each day carry its own width.
//
// It is the SINGLE source of truth for px↔day↔date geometry: the view-model (bar/time-off
// x/width), the header cell widths, every lane overlay, the pointer→day inverse, and the
// live drag preview all go through it. Routing the preview AND the commit through the same
// object is what keeps a drag across a narrow weekend from jumping on release.
//
// Pure and DOM-free, so it's exhaustively unit-tested (columnGeometry.test.ts). The
// load-bearing guarantee proven there: with `minimiseWeekends: false` the geometry is
// byte-identical to the old `index * dayWidth` math (widths are all `dayWidth`, `indexAt`
// reduces to the old floor), and `indexAt` is the EXACT inverse of `x()` at every boundary.

/**
 * Per-column pixel geometry for the visible day window. Build once per render with
 * {@link buildColumnGeometry}; the methods are O(1) (or O(log n) for {@link indexAt}).
 */
export interface ColumnGeometry {
  /** widths[i] = px width of visible day i. */
  readonly widths: number[];
  /** Prefix-summed left edges, length n+1: offsets[i] = left edge of day i, offsets[n] = totalWidth. */
  readonly offsets: number[];
  /** Total px width of the whole window (= offsets[n]). */
  readonly totalWidth: number;
  /** weekdays[i] = weekday of visible day i (0 = Sunday … 6 = Saturday), summed alongside the
   *  widths. Consumers asking "is this column a week start / a weekend?" read it from here rather
   *  than re-parsing the date: the lanes ask that per day PER ROW, so the parses otherwise
   *  multiply by the number of visible resources on every render. */
  readonly weekdays: number[];
  /** True at/above `DAY_COLUMN_MIN_WIDTH`: the zoom is fine enough for per-day columns (the header
   *  renders day cells rather than week blocks, and the lanes paint their per-day decorations).
   *  The SINGLE answer to that question — header, lanes and `minimiseActive` all read it here, so
   *  they cannot flip a zoom step apart. */
  readonly perDayColumns: boolean;
  /** True at/above `WEEKDAY_LABEL_MIN_WIDTH`: the columns have room for the weekday letters
   *  (Mon/Tue…) on top of the date number. Implies {@link perDayColumns}. */
  readonly showWeekdayLabels: boolean;
  /** True when weekends are actually being narrowed (the pref is on AND the zoom is fine
   *  enough that per-day columns render). The header keys its "S" weekend label off this. */
  readonly minimiseActive: boolean;
  /** Left edge px of column `index`, clamped to [0, n] (so an out-of-range index pins to an edge). */
  x(index: number): number;
  /** Width px of column `index` (0 when out of range). */
  widthOf(index: number): number;
  /** Px width spanning columns [startIdx, endIdx] inclusive (≥ 0; 0 when reversed). */
  spanWidth(startIndex: number, endIndex: number): number;
  /** Inverse of {@link x}: a lane-relative pointer x → day index, clamped to [0, n-1].
   *  The EXACT inverse at boundaries — a click at offsets[i] → i, at offsets[i]-ε → i-1. */
  indexAt(px: number): number;
  /** {@link indexAt} for a container's `scrollLeft`: it ROUNDS first. Every scroll-position read
   *  must go through this rather than `indexAt` directly — see resolveWeekStartSnapTarget.ts's "SUB-PIXEL ROUNDING"
   *  note for the full rationale (a HiDPI browser can store scrollLeft a fraction BELOW an integer
   *  column boundary, and indexAt's strict floor would resolve that to the previous — under
   *  minimised weekends, much narrower — column). */
  indexAtScroll(scrollLeft: number): number;
  /** Left edge px of a date. Extrapolates at FULL width outside the window (a bar starting
   *  before day 0 still overflows off-screen-left exactly as it did under the uniform grid),
   *  so off-window bars clip correctly. Returns 0 for an unparseable date (no NaN geometry). */
  xForDateInGeom(date: ISODate): number;
  /** Px width of the inclusive date range [start, end] (≥ 0; 0 when reversed or unparseable). */
  widthForDates(start: ISODate, end: ISODate): number;
}

export interface ColumnGeometryOptions {
  /** The device-global "Minimise weekends" pref. */
  minimiseWeekends: boolean;
  /** Resolved px width for a narrowed weekend column (e.g. WEEKEND_COLUMN_REM × root font px). */
  weekendWidth: number;
  /** Integer width assigned to every calendar week by the viewport fit. Any pixels left after
   *  the base day/weekend widths are spread across individual columns, keeping integer offsets. */
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
 * Weekends are only narrowed when `minimiseWeekends` is on AND `dayWidth >= DAY_COLUMN_MIN_WIDTH`
 * (the per-day-column threshold): below it the header shows week blocks, so narrowing is both
 * meaningless and risky — `weekendWidth` could otherwise exceed `dayWidth` at extreme zoom-out.
 * A non-finite / non-positive `weekendWidth` degrades to no narrowing (full-width weekends), so
 * an unmeasured font size can never inject a NaN width into the prefix sum.
 */
export function buildColumnGeometry(days: ISODate[], dayWidth: number, options: ColumnGeometryOptions): ColumnGeometry {
  const dayCount = days.length;
  const perDayColumns = dayWidth >= DAY_COLUMN_MIN_WIDTH;
  const minimiseActive = options.minimiseWeekends && perDayColumns;
  // A narrowed weekend is never wider than a normal day; an unmeasured/garbage width (NaN, 0)
  // degrades to dayWidth so the prefix sum stays finite and strictly increasing. ROUNDED to a
  // whole pixel so every offset is an integer: a fractional weekend width (e.g. 22.39) makes
  // fractional offsets, but the browser stores scrollLeft as a whole number — the mismatch made
  // the zoom scroll-anchor's indexAt() floor to the previous (weekend) column, drifting the
  // left-edge date back a day on every zoom flip. dayWidth is already integer (resolveColumnFit).
  const measurements = buildColumnMeasurements(days, dayWidth, options);
  const origin = days[0]; // undefined only when n === 0 (an empty window)
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
 * The visible day at a container's left edge, for a given `scrollLeft`.
 *
 * The one place the "which date am I looking at?" read lives: the zoom/recenter scroll anchor, the
 * week-start snap and the visible-window span all answered it separately, and a difference between
 * those answers is a view that jumps. Goes through {@link ColumnGeometry.indexAtScroll}, so the
 * HiDPI sub-pixel rounding applies here too.
 *
 * An empty window has no date and returns undefined. A geometry that resolves outside a non-empty
 * day window violates the alignment invariant and throws.
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
