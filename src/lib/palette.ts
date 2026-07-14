// Default colours for newly-created entities — one place to tune the brand
// palette instead of hex literals scattered across forms.

// One definition lives in the shared core (used by the bar-colour fallback AND external identity);
// re-export it here so app-side imports keep their `../lib/palette` path and the two can't drift.
export { NEUTRAL_COLOR } from '@capacitylens/shared/lib/color'
import { PRESET_COLORS } from '@capacitylens/shared/lib/color'
import { m } from '@/i18n'

export const DEFAULT_COLORS = {
  client: '#2d75da', // blue
  project: '#da2d92', // pink
  discipline: '#5c34d4', // blue-purple
  resource: '#5c34d4', // blue-purple
  placeholder: '#9c3ace', // purple
  account: '#5c34d4', // blue-purple
} as const

// Swatches shown in the ColorField popup — a 13-column × 4-row grid (52 colours).
// Columns sweep the spectrum (red → red-orange → … → pink) with a dedicated brown
// at the end; rows go lightest (top) → darkest (bottom). Generated from HSL: the 12
// spectral hues step evenly in lightness from 85% (a true pastel) down to 35% for a
// strong, obvious gradient, and brown rides ~13pts darker so it reads as brown. The
// matrix deliberately includes every DEFAULT_COLORS value (row 2, the medium-vivid
// band) so a freshly-opened form's default highlights as the selected swatch. No greyscale.
export const SWATCH_COLUMNS = 13
export const SWATCHES = PRESET_COLORS

// Human-readable names for the 13×4 swatch grid, derived from the column (hue) + row (shade) — so
// the swatch buttons get an accessible NAME instead of an unreadable hex like "#e02727" (WCAG
// 1.1.1 / 4.1.2). Columns sweep the spectrum (see SWATCHES); rows go lightest → darkest.
//
// i18n: the hue/shade words resolve through Paraglide (`@/i18n`) at call time so a screen-reader
// user hears them in the active locale. The `swatch_label` message ("{hue} {shade}") owns the word
// ORDER, so a locale can flip hue/shade without touching this code. These are GETTERS (rebuilt per
// call), not module consts, so a locale switch (which happens without a reload) is picked up live.
const swatchHues = (): readonly string[] => [
  m.swatch_hue_red(), m.swatch_hue_orange(), m.swatch_hue_amber(), m.swatch_hue_yellow(),
  m.swatch_hue_lime(), m.swatch_hue_green(), m.swatch_hue_emerald(), m.swatch_hue_cyan(),
  m.swatch_hue_blue(), m.swatch_hue_violet(), m.swatch_hue_purple(), m.swatch_hue_pink(),
  m.swatch_hue_brown(),
]
const swatchShades = (): readonly string[] => [
  m.swatch_shade_pale(), m.swatch_shade_soft(), m.swatch_shade_bright(), m.swatch_shade_dark(),
]

/** Name for the swatch at flat index `i` in the 13×4 grid, e.g. `"Blue bright"`. */
export function swatchLabel(i: number): string {
  const hue = swatchHues()[i % SWATCH_COLUMNS] ?? m.swatch_hue_fallback()
  // Out-of-grid rows have no shade word — return the bare hue (the message's trailing space would
  // otherwise dangle). In-grid (i in 0..51) always resolves a shade.
  const shade = swatchShades()[Math.floor(i / SWATCH_COLUMNS)]
  return shade ? m.swatch_label({ hue, shade }) : hue
}

/** Name for an arbitrary hex when it's a known swatch, else the hex itself (used by the trigger). */
export function colorName(hex: string): string {
  const i = SWATCHES.indexOf(hex)
  return i >= 0 ? swatchLabel(i) : hex
}
