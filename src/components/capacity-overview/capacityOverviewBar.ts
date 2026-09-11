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

// Accessibility fix (2026-09, round 2): a full-saturation `--color-ok` / `--color-destructive`
// fill made the week-cell text unreadable on top of it (WCAG 1.4.3). Round 1 fixed that by
// softening the fill via `color-mix(in oklab, <token> N%, var(--color-surface))`, but the N
// required to keep `text-destructive` (the SAME hue as the fill) legible was so small (~2%) the
// "red fill" stopped reading as red at all — defeating the feature.
//
// The fix is the pattern src/index.css already uses for exactly this split, twice
// (`--c-danger-cell` for a saturated NO-text fill; `--c-danger-soft` / `--c-danger-soft-ink` for a
// tinted fill WITH text on it) — not a third invented scheme:
//   - "bar" mode's number is `sr-only` (not painted): nothing needs AA against the fill, so it
//     uses the "-cell" pair (`--color-ok-cell` / `--color-danger-cell`), which reads clearly green
//     or red at a glance in both themes.
//   - "bar-number" mode paints the number on top of the fill: it uses the "-soft" pair
//     (`--color-ok-soft` / `--color-danger-soft`), and the caller must render the overbooked label
//     in `text-danger-soft-ink` (not `text-destructive`) so it clears AA on its own fill — that is
//     what `--c-danger-soft-ink` ("a step darker than --c-danger to clear AA on the tint") exists
//     for. `--color-ink` and `text-muted-foreground` already clear AA on both "-soft" fills without
//     any change, pinned in capacityOverviewBar.test.ts.
export type CapacityBarFillContext = "bar" | "bar-number";

// WCAG 1.4.1 (Use of Color) fix for pure Bar mode: with the number hidden (`sr-only`), hue alone
// distinguished free from overbooked for a sighted colour-blind viewer. A diagonal hatch — the same
// treatment ClosureBand already uses for a non-colour "this is a special band" cue — gives the
// overbooked fill a texture that survives colour-blindness simulation and greyscale. Bar mode has
// no visible text to protect, so the hatch can freely sit on the vivid `--color-danger-cell`.
//
// The hatch is intentionally NOT applied in "bar-number" mode: there, the printed "Nd overbooked"
// text already satisfies SC 1.4.1 (a non-colour cue is visible), and the hatch's stronger colour
// stripes would sit under that same-hue label, re-introducing an SC 1.4.3 failure.
const OVERBOOKED_HATCH = `repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-destructive) 35%, transparent) 0 3px, transparent 3px 9px)`;

/**
 * Background for the filled portion of a week cell, sized by the caller to `fraction * 100%` and
 * anchored to the bottom of the cell. `context: "bar"` uses the saturated, text-free "-cell" pair
 * plus the overbooked hatch; `context: "bar-number"` uses the AA-paired "-soft" pair (the caller
 * must also switch the overbooked label to `text-danger-soft-ink` in that context).
 */
export function capacityBarFillStyle(fill: CapacityBarFill, context: CapacityBarFillContext): { background: string } {
  if (fill.kind === "none") return { background: "var(--color-faint)" };
  const tokenSuffix = context === "bar" ? "cell" : "soft";
  const fillColor = fill.kind === "free" ? `var(--color-ok-${tokenSuffix})` : `var(--color-danger-${tokenSuffix})`;
  if (fill.kind === "over" && context === "bar") return { background: `${OVERBOOKED_HATCH}, ${fillColor}` };
  return { background: fillColor };
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
