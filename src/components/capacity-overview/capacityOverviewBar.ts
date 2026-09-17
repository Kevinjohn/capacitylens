import { m } from "@/i18n";
import { HOURS_PER_DISPLAY_DAY, roundDownQuarterDays, roundUpQuarterDays } from "./capacityOverviewModel";
import type { CapacityOverviewGroup, CapacityOverviewPeriodResult } from "./capacityOverviewTypes";

/** The two ways a week cell can present a person's capacity. */
export type CapacityDisplayMode = "ledger" | "load-curve";

/** Availability health of a person-week, derived from the share of their capacity still free. */
export type CapacityTone = "ok" | "warn" | "danger";

export interface CapacityCellFill {
  /** 0..1 share of the person's available capacity still free. */
  freeFraction: number;
  /** 0..1 share of the person's available capacity held by tentative work; free + tentative ≤ 1. */
  tentativeFraction: number;
  tone: CapacityTone;
}

const OK_FREE_SHARE = 0.8;
const WARN_FREE_SHARE = 0.4;

/** Tentative work is always a neutral grey hatch: amber is reserved for low availability. */
export function buildTentativeHatch(stripe: number): string {
  return `repeating-linear-gradient(45deg, var(--color-faint) 0 ${stripe}px, transparent ${stripe}px ${stripe * 2}px)`;
}
export const TENTATIVE_HATCH = buildTentativeHatch(3);

export const TONE_FILL: Record<CapacityTone, string> = {
  ok: "var(--color-ok)",
  warn: "var(--color-warn)",
  danger: "var(--color-danger)",
};

/**
 * Availability tone from the share of capacity still free: at least 80% free reads healthy, at
 * least 40% reads as a warning, anything less reads as danger. Shares, not fixed day counts, keep a
 * three-day person and a partial first week on the same scale as a full five-day week.
 */
export function resolveCapacityTone(freeHours: number, availableHours: number): CapacityTone {
  if (availableHours <= 0 || freeHours <= 0) return "danger";
  const share = freeHours / availableHours;
  if (share >= OK_FREE_SHARE) return "ok";
  if (share >= WARN_FREE_SHARE) return "warn";
  return "danger";
}

/**
 * Pure fraction helper for a person-week bar. It reads the rounded day figures the cell prints, not
 * the precise hours, so a "—" never sits beside a painted sliver and the tone matches the number.
 */
export function computeCapacityCellFill({
  availableHours,
  freeDays,
  tentativeDays,
}: Pick<CapacityOverviewPeriodResult, "availableHours" | "freeDays" | "tentativeDays">): CapacityCellFill {
  if (availableHours <= 0) return { freeFraction: 0, tentativeFraction: 0, tone: "danger" };
  const freeHours = Math.max(freeDays, 0) * HOURS_PER_DISPLAY_DAY;
  const freeFraction = Math.min(freeHours / availableHours, 1);
  const tentativeFraction = Math.min(
    (Math.max(tentativeDays, 0) * HOURS_PER_DISPLAY_DAY) / availableHours,
    1 - freeFraction,
  );
  return { freeFraction, tentativeFraction, tone: resolveCapacityTone(freeHours, availableHours) };
}

/** Ink for a week's committed percentage: danger once tentative work would push it to 90%. */
export type CapacityTotalsTone = "danger" | "ink" | "muted";

export interface CapacityPeriodTotals {
  capacityDays: number;
  freeDays: number;
  tentativeDays: number;
  committedDays: number;
  overDays: number;
  committedPct: number;
  tentativePct: number;
  tone: CapacityTotalsTone;
}

function resolveTotalsTone(committedPct: number, tentativePct: number): CapacityTotalsTone {
  if (committedPct + tentativePct >= 90) return "danger";
  if (committedPct >= 60) return "ink";
  return "muted";
}

/**
 * Per-week totals over the people currently shown (placeholders carry demand, not capacity).
 * Committed load is what is neither free nor tentative, so the header bar's committed segment plus
 * its tentative hatch never exceeds the track.
 */
export function buildPeriodTotals(groups: CapacityOverviewGroup[], periodCount: number): CapacityPeriodTotals[] {
  const rows = groups.flatMap((group) => group.rows).filter((row) => row.resource.kind !== "placeholder");
  return Array.from({ length: periodCount }, (_unused, index) => {
    const periods = rows.map((row) => row.periods[index]).filter((period) => period !== undefined);
    const availableHours = periods.reduce((sum, period) => sum + period.availableHours, 0);
    const freeHours = periods.reduce((sum, period) => sum + period.freeHours, 0);
    const tentativeHours = periods.reduce((sum, period) => sum + period.tentativeHours, 0);
    const overHours = periods.reduce((sum, period) => sum + period.overHours, 0);
    const committedHours = Math.max(availableHours - freeHours - tentativeHours, 0);
    const committedPct = availableHours > 0 ? Math.round((committedHours / availableHours) * 100) : 0;
    // Rounded independently the two shares can reach 101%; the bar and the tone read them as one.
    const tentativePct = Math.min(
      availableHours > 0 ? Math.round((tentativeHours / availableHours) * 100) : 0,
      100 - committedPct,
    );
    return {
      capacityDays: availableHours / HOURS_PER_DISPLAY_DAY,
      freeDays: roundDownQuarterDays(freeHours),
      tentativeDays: roundDownQuarterDays(tentativeHours),
      committedDays: roundUpQuarterDays(committedHours),
      overDays: roundUpQuarterDays(overHours),
      committedPct,
      tentativePct,
      tone: resolveTotalsTone(committedPct, tentativePct),
    };
  });
}

/** Day figures print bare integers and trimmed fractions: 5 → "5", 1.5 → "1.5", 1.25 → "1.25". */
export function formatDayFigure(days: number): string {
  return String(Math.round(days * 100) / 100);
}

export function formatDays(days: number, kind: "capacity" | "overbooked" | "unassigned" | "tentative"): string {
  const figure = formatDayFigure(days);
  if (kind === "capacity") return m.capacity_overview_days({ days: figure });
  if (kind === "overbooked") return m.capacity_overview_days_overbooked({ days: figure });
  if (kind === "tentative") return m.capacity_overview_tentative_days({ days: figure });
  return m.capacity_overview_days_unassigned({ days: figure });
}

/** "16 – 20 Sep · 2d free of 5d · 1d tentative · 0.25d overbooked": the hover and screen-reader text. */
export function describePeriod(result: CapacityOverviewPeriodResult, rangeLabel: string): string {
  const parts: string[] = [
    m.capacity_overview_cell_title({
      range: rangeLabel,
      free: formatDayFigure(result.freeDays),
      capacity: formatDayFigure(result.availableHours / HOURS_PER_DISPLAY_DAY),
    }),
  ];
  if (result.tentativeDays > 0) parts.push(formatDays(result.tentativeDays, "tentative"));
  if (result.overDays > 0) parts.push(formatDays(result.overDays, "overbooked"));
  return parts.join(" · ");
}

export function describeTotals(totals: CapacityPeriodTotals, rangeLabel: string): string {
  const parts: string[] = [
    m.capacity_overview_totals_title({
      range: rangeLabel,
      committed: formatDayFigure(totals.committedDays),
      capacity: formatDayFigure(totals.capacityDays),
    }),
  ];
  if (totals.tentativeDays > 0) parts.push(formatDays(totals.tentativeDays, "tentative"));
  if (totals.overDays > 0) parts.push(formatDays(totals.overDays, "overbooked"));
  return parts.join(" · ");
}
