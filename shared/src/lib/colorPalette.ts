import { parseRgb } from "./colorPrimitives";
import type { RgbChannels } from "./colorPrimitives";

/** The single neutral grey, the bar/colour fallback and the colour of external / 3rd-party
 * identity (avatar, swatch, band, bars). Re-exported app-side as `NEUTRAL_COLOR` from
 * src/lib/palette so both sides share one definition. */
export const NEUTRAL_COLOR = "#9ca3af";
/** Canonical user-selectable colour palette. Persisted user colours must belong to this set.
 * `NEUTRAL_COLOR` (external resources) and the Internal-client colour are deliberate system
 * exceptions and are therefore not included here. */
export const PRESET_COLORS = Object.freeze([
  "#f5bcbc",
  "#f7caba",
  "#f9d9b8",
  "#f9e6b8",
  "#f9f1b8",
  "#d9f2c0",
  "#c2f0d1",
  "#c0edf2",
  "#bed4f4",
  "#ccc0f2",
  "#e0c2f0",
  "#f4bedd",
  "#d8b397",
  "#eb7272",
  "#ef906e",
  "#f3ae6a",
  "#f3ca6a",
  "#f3e16a",
  "#aee37a",
  "#7edf9e",
  "#7adae3",
  "#76a5e7",
  "#947ae3",
  "#be7edf",
  "#e776b8",
  "#c38c61",
  "#e02727",
  "#e65621",
  "#ed841b",
  "#edae1b",
  "#edd11b",
  "#84d434",
  "#3ace6b",
  "#34c7d4",
  "#2d75da",
  "#5c34d4",
  "#9c3ace",
  "#da2d92",
  "#9e663c",
  "#9c1616",
  "#a13812",
  "#a5590d",
  "#a5780d",
  "#a5910d",
  "#59931f",
  "#248f47",
  "#1f8a93",
  "#1b4f98",
  "#3c1f93",
  "#6b248f",
  "#981b64",
  "#684327",
] as const);
// Cache palette channels so nearest-colour lookup avoids reparsing every swatch.
// Preserve palette order for deterministic ties and skip invalid entries rather than propagating NaN.
const PRESET_COLOR_SET = new Set<string>(PRESET_COLORS);
const PRESET_RGB: readonly (RgbChannels | null)[] = PRESET_COLORS.map((preset) => parseRgb(preset));

/** True when the value is one of the preset swatches, ignoring case and surrounding space. Pure. */
export function isPresetColor(value: unknown): value is string {
  return typeof value === "string" && PRESET_COLOR_SET.has(value.trim().toLowerCase());
}

/** Preset used when an input cannot be parsed as a six-digit hex colour. */
export const FALLBACK_PRESET_COLOR = "#5c34d4";

/**
 * Snap any colour value to the canonical `PRESET_COLORS` palette:
 *  - a value already in the palette is returned normalized (trimmed + lowercased);
 *  - any other parseable 6-digit hex is mapped to its nearest preset by RGB Euclidean distance
 *    (ties broken by palette order, the first minimal-distance preset wins, so the mapping is
 *    deterministic and reproducible);
 *  - an unparseable value (wrong shape, non-string, `null`/`undefined`) returns
 *    {@link FALLBACK_PRESET_COLOR}.
 *
 * This is the mapping used by import repair and the one-time
 * `snap-legacy-account-colors` DB migration and the client store. Ordinary server writes
 * validate supplied colours against the preset set before this mapper runs.
 * See DECISIONS.md for the policy this implements.
 */
export function snapToPresetColor(value: unknown): string {
  if (typeof value !== "string") return FALLBACK_PRESET_COLOR;
  const normalized = value.trim().toLowerCase();
  if (PRESET_COLOR_SET.has(normalized)) return normalized;
  const channels = parseRgb(normalized);
  if (!channels) return FALLBACK_PRESET_COLOR;
  const { red: r, green: g, blue: b } = channels;
  let nearest: string = FALLBACK_PRESET_COLOR;
  let nearestDistance = Infinity;
  for (const [i, preset] of PRESET_COLORS.entries()) {
    const presetRgb = PRESET_RGB[i];
    // Every frozen palette entry is a valid six-digit hex value, as pinned by a test.
    if (!presetRgb) continue;
    const { red: pr, green: pg, blue: pb } = presetRgb;
    // Squared Euclidean distance in RGB space. No sqrt needed since we only compare magnitudes.
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    // Strict `<` (not `<=`) so the first minimal-distance preset wins on a tie, palette order
    // is the deterministic tie-break.
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = preset;
    }
  }
  return nearest;
}
