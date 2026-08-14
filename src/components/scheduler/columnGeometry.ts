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
  spanWidth(startIdx: number, endIdx: number): number;
  /** Inverse of {@link x}: a lane-relative pointer x → day index, clamped to [0, n-1].
   *  The EXACT inverse at boundaries — a click at offsets[i] → i, at offsets[i]-ε → i-1. */
  indexAt(px: number): number;
  /** {@link indexAt} for a container's `scrollLeft`: it ROUNDS first. Every scroll-position read
   *  must go through this rather than `indexAt` directly — see weekSnap.ts's "SUB-PIXEL ROUNDING"
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

export interface BuildGeometryOpts {
  /** The device-global "Minimise weekends" pref. */
  minimiseWeekends: boolean;
  /** Resolved px width for a narrowed weekend column (e.g. WEEKEND_COLUMN_REM × root font px). */
  weekendWidth: number;
  /** Integer width assigned to every calendar week by the viewport fit. Any pixels left after
   *  the base day/weekend widths are spread across individual columns, keeping integer offsets. */
  targetWeekWidth?: number;
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
export function buildColumnGeometry(days: ISODate[], dayWidth: number, opts: BuildGeometryOpts): ColumnGeometry {
  const n = days.length;
  const perDayColumns = dayWidth >= DAY_COLUMN_MIN_WIDTH;
  const minimiseActive = opts.minimiseWeekends && perDayColumns;
  // A narrowed weekend is never wider than a normal day; an unmeasured/garbage width (NaN, 0)
  // degrades to dayWidth so the prefix sum stays finite and strictly increasing. ROUNDED to a
  // whole pixel so every offset is an integer: a fractional weekend width (e.g. 22.39) makes
  // fractional offsets, but the browser stores scrollLeft as a whole number — the mismatch made
  // the zoom scroll-anchor's indexAt() floor to the previous (weekend) column, drifting the
  // left-edge date back a day on every zoom flip. dayWidth is already integer (resolveColumnFit).
  const rawNarrow = Math.round(Math.min(opts.weekendWidth, dayWidth));
  const narrowWidth = Number.isFinite(rawNarrow) && rawNarrow > 0 ? rawNarrow : dayWidth;
  const baseWeekWidth = minimiseActive ? 5 * dayWidth + 2 * narrowWidth : 7 * dayWidth;
  const requestedWeekWidth = Math.round(opts.targetWeekWidth ?? baseWeekWidth);
  // resolveColumnFit floors the base width, so this is normally 0..4 (minimised) or 0..6
  // (uniform). Clamp defensive callers to the available columns: distributing more than one extra
  // pixel per column would obscure what `dayWidth` means and is never needed by the real fit.
  const extraPixels = Math.min(
    minimiseActive ? 5 : 7,
    Math.max(0, Number.isFinite(requestedWeekWidth) ? requestedWeekWidth - baseWeekWidth : 0),
  );

  const widths: number[] = new Array(n);
  const offsets: number[] = new Array(n + 1);
  const weekdays: number[] = new Array(n);
  offsets[0] = 0;
  for (let i = 0; i < n; i++) {
    const wd = weekdayOf(days[i]);
    weekdays[i] = wd;
    const isWeekend = wd === 0 || wd === 6;
    const extra = minimiseActive ? !isWeekend && wd - 1 < extraPixels : wd < extraPixels;
    widths[i] = minimiseActive && isWeekend ? narrowWidth : dayWidth + (extra ? 1 : 0);
    offsets[i + 1] = offsets[i] + widths[i];
  }
  const totalWidth = offsets[n];
  const origin = days[0]; // undefined only when n === 0 (an empty window)

  const clampEdge = (i: number): number => (i < 0 ? 0 : i > n ? n : i);

  // Date → px allowing extrapolation outside [0, n]. In-window it's a prefix-sum lookup;
  // outside it continues at full `dayWidth` so off-window bars keep the old overflow geometry.
  const xForDayIndex = (i: number): number => {
    if (i < 0) return i * dayWidth;
    if (i > n) return totalWidth + (i - n) * dayWidth;
    return offsets[i];
  };

  const indexAt = (px: number): number => {
    if (n === 0 || px <= 0) return 0;
    if (px >= totalWidth) return n - 1;
    // Largest i in [0, n-1] with offsets[i] <= px. offsets is strictly increasing (every
    // width > 0), so this is the exact inverse of x(): px === offsets[i] resolves to i.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= px) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  return {
    widths,
    offsets,
    totalWidth,
    weekdays,
    perDayColumns,
    showWeekdayLabels: dayWidth >= WEEKDAY_LABEL_MIN_WIDTH,
    minimiseActive,
    x: (index) => offsets[clampEdge(index)],
    widthOf: (index) => (index >= 0 && index < n ? widths[index] : 0),
    spanWidth: (startIdx, endIdx) => Math.max(0, offsets[clampEdge(endIdx + 1)] - offsets[clampEdge(startIdx)]),
    indexAt,
    indexAtScroll: (scrollLeft) => indexAt(Math.round(scrollLeft)),
    xForDateInGeom: (date) => {
      if (!origin) return 0;
      const i = dayIndex(date, origin);
      return Number.isFinite(i) ? xForDayIndex(i) : 0;
    },
    widthForDates: (start, end) => {
      if (!origin) return 0;
      const s = dayIndex(start, origin);
      const e = dayIndex(end, origin);
      // Reversed or unparseable range → 0 (a harmless zero-width bar), never negative / NaN —
      // mirrors the old widthForRange contract.
      if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
      return Math.max(0, xForDayIndex(e + 1) - xForDayIndex(s));
    },
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
 * `?? days[0]` covers an out-of-range index from a custom geometry implementation; on an EMPTY
 * window there is no such date and the result is undefined at runtime (callers that can be handed
 * one — `visibleStartDate` — keep their own final fallback).
 */
export function leftEdgeDate(geom: ColumnGeometry, days: ISODate[], scrollLeft: number): ISODate {
  return days[geom.indexAtScroll(scrollLeft)] ?? days[0];
}
