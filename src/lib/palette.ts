// Default colours for newly-created entities — one place to tune the brand
// palette instead of hex literals scattered across forms.

export const NEUTRAL_COLOR = '#9ca3af'

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
export const SWATCHES: readonly string[] = [
  // row 0 (lightest)
  '#f5bcbc', '#f7caba', '#f9d9b8', '#f9e6b8', '#f9f1b8', '#d9f2c0', '#c2f0d1', '#c0edf2', '#bed4f4', '#ccc0f2', '#e0c2f0', '#f4bedd', '#d8b397',
  // row 1
  '#eb7272', '#ef906e', '#f3ae6a', '#f3ca6a', '#f3e16a', '#aee37a', '#7edf9e', '#7adae3', '#76a5e7', '#947ae3', '#be7edf', '#e776b8', '#c38c61',
  // row 2
  '#e02727', '#e65621', '#ed841b', '#edae1b', '#edd11b', '#84d434', '#3ace6b', '#34c7d4', '#2d75da', '#5c34d4', '#9c3ace', '#da2d92', '#9e663c',
  // row 3 (darkest)
  '#9c1616', '#a13812', '#a5590d', '#a5780d', '#a5910d', '#59931f', '#248f47', '#1f8a93', '#1b4f98', '#3c1f93', '#6b248f', '#981b64', '#684327',
]
