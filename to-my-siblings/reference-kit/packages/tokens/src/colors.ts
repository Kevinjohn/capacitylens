/** Neutral identity/fallback colour shared by every product. */
export const NEUTRAL_COLOR = '#9ca3af'

/** Persistable family swatches. Product-only system colours should not be added here. */
export const PRESET_COLORS: readonly string[] = [
  '#f5bcbc', '#f7caba', '#f9d9b8', '#f9e6b8', '#f9f1b8', '#d9f2c0', '#c2f0d1', '#c0edf2', '#bed4f4', '#ccc0f2', '#e0c2f0', '#f4bedd', '#d8b397',
  '#eb7272', '#ef906e', '#f3ae6a', '#f3ca6a', '#f3e16a', '#aee37a', '#7edf9e', '#7adae3', '#76a5e7', '#947ae3', '#be7edf', '#e776b8', '#c38c61',
  '#e02727', '#e65621', '#ed841b', '#edae1b', '#edd11b', '#84d434', '#3ace6b', '#34c7d4', '#2d75da', '#5c34d4', '#9c3ace', '#da2d92', '#9e663c',
  '#9c1616', '#a13812', '#a5590d', '#a5780d', '#a5910d', '#59931f', '#248f47', '#1f8a93', '#1b4f98', '#3c1f93', '#6b248f', '#981b64', '#684327',
]

const PRESET_COLOR_SET = new Set(PRESET_COLORS)
const DARK_INK = '#1c2230'
const LIGHT_INK = '#ffffff'
const AA_NORMAL = 4.5

export function isPresetColor(value: unknown): value is string {
  return typeof value === 'string' && PRESET_COLOR_SET.has(value.trim().toLowerCase())
}

function channelLin(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number | null {
  const color = hex.replace('#', '')
  if (color.length !== 6) return null
  const red = parseInt(color.slice(0, 2), 16)
  const green = parseInt(color.slice(2, 4), 16)
  const blue = parseInt(color.slice(4, 6), 16)
  if ([red, green, blue].some(Number.isNaN)) return null
  return 0.2126 * channelLin(red) + 0.7152 * channelLin(green) + 0.0722 * channelLin(blue)
}

export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexA)
  const luminanceB = relativeLuminance(hexB)
  if (luminanceA === null || luminanceB === null) return 1
  const high = Math.max(luminanceA, luminanceB)
  const low = Math.min(luminanceA, luminanceB)
  return (high + 0.05) / (low + 0.05)
}

const DARK_INK_LUMINANCE = relativeLuminance(DARK_INK) ?? 0

/** Choose white or family dark ink, whichever has better WCAG contrast. */
export function readableTextColor(hex: string): string {
  const background = relativeLuminance(hex)
  if (background === null) return DARK_INK
  const whiteContrast = 1.05 / (background + 0.05)
  const darkContrast =
    (Math.max(background, DARK_INK_LUMINANCE) + 0.05) /
    (Math.min(background, DARK_INK_LUMINANCE) + 0.05)
  return whiteContrast >= darkContrast ? LIGHT_INK : DARK_INK
}

function toRgb(hex: string): [number, number, number] | null {
  const color = hex.replace('#', '')
  if (color.length !== 6) return null
  const red = parseInt(color.slice(0, 2), 16)
  const green = parseInt(color.slice(2, 4), 16)
  const blue = parseInt(color.slice(4, 6), 16)
  return [red, green, blue].some(Number.isNaN) ? null : [red, green, blue]
}

function toHex(red: number, green: number, blue: number): string {
  const channels = [red, green, blue].map((value) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'),
  )
  return '#' + channels.join('')
}

/**
 * Preserve hue while nudging a background until its selected text colour clears WCAG AA.
 */
export function ensureAccessibleColors(hex: string): { bg: string; ink: string } {
  const rgb = toRgb(hex)
  const ink = readableTextColor(hex)
  if (!rgb) return { bg: NEUTRAL_COLOR, ink: readableTextColor(NEUTRAL_COLOR) }

  let [red, green, blue] = rgb
  const darken = ink === LIGHT_INK
  let background = hex
  for (let index = 0; index < 30 && contrastRatio(background, ink) < AA_NORMAL; index++) {
    if (darken) {
      red *= 0.92
      green *= 0.92
      blue *= 0.92
    } else {
      red += (255 - red) * 0.12
      green += (255 - green) * 0.12
      blue += (255 - blue) * 0.12
    }
    background = toHex(red, green, blue)
  }
  return { bg: background, ink }
}

/** True only for a six-digit `#rrggbb` colour. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim())
}
