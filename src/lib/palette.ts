// Default colours for newly-created entities, one place to tune the brand
// palette instead of hex literals scattered across forms.

// Share canonical preset colors so app presentation and domain fallbacks cannot drift.
export { NEUTRAL_COLOR } from "@capacitylens/shared/lib/colorPalette";
import { PRESET_COLORS } from "@capacitylens/shared/lib/colorPalette";
import { m } from "@/i18n";

/** Default preset colors grouped by entity type. */
export const DEFAULT_COLORS = {
  client: "#2d75da",
  project: "#da2d92",
  discipline: "#2d75da",
  resource: "#2d75da",
  placeholder: "#2d75da",
  account: "#2d75da",
} as const;

// Arrange swatches by hue and shade while including every default preset so a new
// form’s initial color has a selected swatch.
/** Number of columns used to arrange the color swatches. */
export const SWATCH_COLUMNS = 13;

/** Read-only swatch list backed by the canonical preset colors. */
export const SWATCHES: readonly string[] = PRESET_COLORS;

// Lowercase hex -> index into SWATCHES, built once from the static swatch list so callers
// (e.g. ColorField's selected-swatch lookup) get O(1) instead of a per-render linear scan.
const SWATCH_INDEX_BY_HEX = new Map(SWATCHES.map((hex, i) => [hex.toLowerCase(), i]));

/** Index of `hex` (case-insensitive) within SWATCHES, or -1 when it isn't a known swatch. */
export function resolveSwatchIndex(hex: string): number {
  return SWATCH_INDEX_BY_HEX.get(hex.toLowerCase()) ?? -1;
}

// Use localized hue and shade names so swatches have meaningful accessible labels.
// Resolve them at lookup to follow the active account locale.
const listSwatchHues = (): readonly string[] => [
  m.swatch_hue_red(),
  m.swatch_hue_orange(),
  m.swatch_hue_amber(),
  m.swatch_hue_yellow(),
  m.swatch_hue_lime(),
  m.swatch_hue_green(),
  m.swatch_hue_emerald(),
  m.swatch_hue_cyan(),
  m.swatch_hue_blue(),
  m.swatch_hue_violet(),
  m.swatch_hue_purple(),
  m.swatch_hue_pink(),
  m.swatch_hue_brown(),
];
const listSwatchShades = (): readonly string[] => [
  m.swatch_shade_pale(),
  m.swatch_shade_soft(),
  m.swatch_shade_bright(),
  m.swatch_shade_dark(),
];

/** Name for the swatch at flat index `i` in the 13×4 grid, e.g. `"Blue bright"`. */
export function resolveSwatchLabel(i: number): string {
  const hue = listSwatchHues()[i % SWATCH_COLUMNS] ?? m.swatch_hue_fallback();
  // Out-of-grid rows have no shade word, return the bare hue (the message's trailing space would
  // otherwise dangle). In-grid (i in 0..51) always resolves a shade.
  const shade = listSwatchShades()[Math.floor(i / SWATCH_COLUMNS)];
  return shade ? m.swatch_label({ hue, shade }) : hue;
}

/** Name for an arbitrary hex when it's a known swatch, else the hex itself (used by the trigger). */
export function resolveColorName(hex: string): string {
  const i = SWATCHES.indexOf(hex);
  return i >= 0 ? resolveSwatchLabel(i) : hex;
}
