import type { CapacityOverviewWeekResult } from "./capacityOverviewTypes";

/** The three ways a week cell can present a person's capacity. */
export type CapacityDisplayMode = "bar" | "bar-number" | "number";

export type CapacityBarFillKind = "free" | "over" | "none";

export interface CapacityBarFill {
  kind: CapacityBarFillKind;
  /** 0..1 proportion of the week's own availability, already capped at 1 for overbooking. */
  fraction: number;
}

/**
 * Pure fraction helper for the Overview bar fill. Uses the model's precise hours (not the
 * quarter-day rounded display values) and the person's own availability for the week, so a
 * partial first week or a part-time working pattern is proportioned correctly.
 */
export function computeCapacityBarFill({
  availableHours,
  freeHours,
  overHours,
}: {
  availableHours: number;
  freeHours: number;
  overHours: number;
}): CapacityBarFill {
  if (availableHours <= 0) return { kind: "none", fraction: 0 };
  if (overHours > 0) return { kind: "over", fraction: Math.min(overHours / availableHours, 1) };
  if (freeHours > 0) return { kind: "free", fraction: Math.min(freeHours / availableHours, 1) };
  return { kind: "none", fraction: 0 };
}

/**
 * Background for the week cell: filled bottom-up from `--color-ok`/`--color-destructive` tokens,
 * grey (`--color-faint`) above the fill and for a person with nothing to show.
 */
export function capacityBarBackground(fill: CapacityBarFill): { background: string } {
  if (fill.kind === "none") return { background: "var(--color-faint)" };
  const filledColor = fill.kind === "free" ? "var(--color-ok)" : "var(--color-destructive)";
  const percent = fill.fraction * 100;
  return {
    background: `linear-gradient(to top, ${filledColor} 0%, ${filledColor} ${percent}%, var(--color-faint) ${percent}%, var(--color-faint) 100%)`,
  };
}

/** Same text the Number mode prints for a week result, reused as the Bar-mode accessible label. */
export function formatWeekValueText(
  result: Pick<CapacityOverviewWeekResult, "state" | "freeDays" | "overDays">,
  formatDays: (days: number, kind: "capacity" | "overbooked") => string,
  dash: string,
): string {
  const parts: string[] = [result.state === "available" ? formatDays(result.freeDays, "capacity") : dash];
  if (result.overDays > 0) parts.push(formatDays(result.overDays, "overbooked"));
  return parts.join(", ");
}
