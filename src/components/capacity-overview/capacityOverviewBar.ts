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

// Accessibility fix (2026-09): a full-saturation `--color-ok` / `--color-destructive` fill made
// the existing week-cell text unreadable on top of it (WCAG 1.4.3 failures) — the free-days number
// (`--color-ink`), the overbooked label (`text-destructive`, i.e. the SAME hue as the fill) and the
// EmptyCapacity dash (`text-muted-foreground`) all dropped well below the 4.5:1 AA minimum.
//
// Softening the fill with `color-mix(in oklab, <token> N%, var(--color-surface))` keeps the colour
// on-token (per #795) while restoring AA. The two N values below are the maximum saturation that
// still clears 4.5:1 for every one of those three text colours, in BOTH themes — verified against
// the resolved tokens (light: --c-ink #1c2230, --c-muted #5b6472, --c-danger #e11d48, --c-ok
// #047857, --c-surface #ffffff; dark: --c-ink #e7eaf0, --c-muted #a3acbd, --c-danger #fb7185,
// --c-ok #34d399, --c-surface #161922), and pinned by contrast assertions in
// capacityOverviewBar.test.ts. `text-destructive` on its own hue is the binding constraint for the
// destructive fill: because the label and the fill share the same hue, the fill must stay very
// close to the surface colour (worst case ~4.57:1 in light) for the label to stay legible — a
// visibly stronger red tint would fail SC 1.4.3 for that label. The overbooked bar's fraction and
// the printed "Nd overbooked" text carry the overbooking signal; the pale tint is a supporting cue,
// not the primary one.
// Exported so capacityOverviewBar.test.ts can pin the contrast guarantee against the ACTUAL
// tokens in src/index.css, rather than duplicating these numbers as a second hardcoded copy that
// could silently drift from the ones the component really uses.
export const OK_FILL_MIX_PERCENT = 12;
export const DESTRUCTIVE_FILL_MIX_PERCENT = 2;

function softenedFill(kind: Exclude<CapacityBarFillKind, "none">): string {
  const token = kind === "free" ? "--color-ok" : "--color-destructive";
  const percent = kind === "free" ? OK_FILL_MIX_PERCENT : DESTRUCTIVE_FILL_MIX_PERCENT;
  return `color-mix(in oklab, var(${token}) ${percent}%, var(--color-surface))`;
}

// WCAG 1.4.1 (Use of Color) fix for pure Bar mode: with the number hidden (`sr-only`), hue alone
// distinguished free from overbooked for a sighted colour-blind viewer. A diagonal hatch — the same
// treatment ClosureBand already uses for a non-colour "this is a special band" cue — gives the
// overbooked fill a texture that survives colour-blindness simulation and greyscale.
//
// The hatch is intentionally NOT applied in "bar-number" mode: there, the printed "Nd overbooked"
// text already satisfies SC 1.4.1 (a non-colour cue is visible), and the hatch's stronger colour
// stripes sit under that same-hue text — re-introducing the SC 1.4.3 failure the softened fill was
// built to fix. Bar mode has no such conflict because its number is `sr-only` (not painted).
const OVERBOOKED_HATCH = `repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-destructive) 35%, transparent) 0 3px, transparent 3px 9px)`;

/**
 * Background for the filled portion of a week cell, sized by the caller to `fraction * 100%` and
 * anchored to the bottom of the cell. `hatch: true` overlays the overbooked-only diagonal texture
 * (ignored for a "free" fill, which never needs a non-colour cue: the number is the same colour as
 * every other free cell).
 */
export function capacityBarFillStyle(fill: CapacityBarFill, hatch: boolean): { background: string } {
  if (fill.kind === "none") return { background: "var(--color-faint)" };
  const fillColor = softenedFill(fill.kind);
  if (fill.kind === "over" && hatch) return { background: `${OVERBOOKED_HATCH}, ${fillColor}` };
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
