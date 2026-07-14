import { isExternalResource } from '../types/entities'
import type { Allocation, Client, ID, Project, Resource, Activity } from '../types/entities'

/** The single neutral grey — the bar/colour fallback AND the colour of external / 3rd-party
 *  identity (avatar, swatch, band, bars). Re-exported app-side as `NEUTRAL_COLOR` from
 *  src/lib/palette so both sides share ONE definition. */
export const NEUTRAL_COLOR = '#9ca3af'
/** Canonical user-selectable colour palette. Persisted user colours must belong to this set.
 * `NEUTRAL_COLOR` (external resources) and the Internal-client colour are deliberate system
 * exceptions and are therefore not included here. */
export const PRESET_COLORS: readonly string[] = [
  '#f5bcbc', '#f7caba', '#f9d9b8', '#f9e6b8', '#f9f1b8', '#d9f2c0', '#c2f0d1', '#c0edf2', '#bed4f4', '#ccc0f2', '#e0c2f0', '#f4bedd', '#d8b397',
  '#eb7272', '#ef906e', '#f3ae6a', '#f3ca6a', '#f3e16a', '#aee37a', '#7edf9e', '#7adae3', '#76a5e7', '#947ae3', '#be7edf', '#e776b8', '#c38c61',
  '#e02727', '#e65621', '#ed841b', '#edae1b', '#edd11b', '#84d434', '#3ace6b', '#34c7d4', '#2d75da', '#5c34d4', '#9c3ace', '#da2d92', '#9e663c',
  '#9c1616', '#a13812', '#a5590d', '#a5780d', '#a5910d', '#59931f', '#248f47', '#1f8a93', '#1b4f98', '#3c1f93', '#6b248f', '#981b64', '#684327',
]
const PRESET_COLOR_SET = new Set(PRESET_COLORS)

export function isPresetColor(value: unknown): value is string {
  return typeof value === 'string' && PRESET_COLOR_SET.has(value.trim().toLowerCase())
}
const FALLBACK = NEUTRAL_COLOR

/** Id→entity maps for O(1) colour resolution. The scheduler model already builds
 *  these to position bars, so colour resolution reuses them instead of re-scanning
 *  the raw arrays once per bar. */
export interface BarColorMaps {
  activities: Map<ID, Activity>
  projects: Map<ID, Project>
  clients: Map<ID, Client>
  resources: Map<ID, Resource>
}

// Bars are coloured by their project, falling back to the
// client colour, then the resource colour, then a neutral grey — so a bar is
// always visible even if some relation is missing.
export function resolveBarColor(allocation: Allocation, maps: BarColorMaps): string {
  const resource = maps.resources.get(allocation.resourceId)
  // External / 3rd-party work reads as a single neutral colour (an "awareness" signal),
  // overriding the usual project→client colouring so an outsourced bar never looks like one of
  // our own. See DECISIONS.md "external kind": single neutral colour.
  if (resource && isExternalResource(resource)) return NEUTRAL_COLOR
  const activity = maps.activities.get(allocation.activityId)
  const project = activity?.projectId ? maps.projects.get(activity.projectId) : undefined
  if (project?.color) return project.color

  const client = project ? maps.clients.get(project.clientId) : undefined
  if (client?.color) return client.color

  return resource?.color ?? FALLBACK
}

const DARK_INK = '#1c2230'
const LIGHT_INK = '#ffffff'

// WCAG relative luminance: linearise each sRGB channel before weighting.
function channelLin(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number | null {
  const c = hex.replace('#', '')
  if (c.length !== 6) return null // reject short AND overlong hex (the latter mis-slices)
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return null
  return 0.2126 * channelLin(r) + 0.7152 * channelLin(g) + 0.0722 * channelLin(b)
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  if (la === null || lb === null) return 1
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

const DARK_INK_LUM = relativeLuminance(DARK_INK) ?? 0

/** Pick whichever of white / dark ink has the higher WCAG contrast on `hex`. */
export function readableTextColor(hex: string): string {
  const bg = relativeLuminance(hex)
  if (bg === null) return DARK_INK
  const contrastWhite = (1 + 0.05) / (bg + 0.05)
  const contrastDark = (Math.max(bg, DARK_INK_LUM) + 0.05) / (Math.min(bg, DARK_INK_LUM) + 0.05)
  return contrastWhite >= contrastDark ? LIGHT_INK : DARK_INK
}

const AA_NORMAL = 4.5

function toRgb(hex: string): [number, number, number] | null {
  const c = hex.replace('#', '')
  if (c.length !== 6) return null // reject short AND overlong hex (the latter mis-slices)
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return [r, g, b].some(Number.isNaN) ? null : [r, g, b]
}

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

/**
 * Bar label legibility: many mid-tone colours give neither white nor dark ink a
 * 4.5:1 ratio (e.g. the default indigo/blue/purple all land ~4.0–4.5). Keep the
 * chosen hue but nudge its lightness — darker under white ink, lighter under dark
 * ink — until the label clears WCAG AA. Returns the adjusted background + its ink.
 */
export function ensureBarColors(hex: string): { bg: string; ink: string } {
  const rgb = toRgb(hex)
  const ink = readableTextColor(hex)
  if (!rgb) return { bg: FALLBACK, ink: readableTextColor(FALLBACK) }
  let [r, g, b] = rgb
  const darken = ink === LIGHT_INK
  let bg = hex
  for (let i = 0; i < 30 && contrastRatio(bg, ink) < AA_NORMAL; i++) {
    if (darken) {
      r *= 0.92
      g *= 0.92
      b *= 0.92
    } else {
      r += (255 - r) * 0.12
      g += (255 - g) * 0.12
      b += (255 - b) * 0.12
    }
    bg = toHex(r, g, b)
  }
  return { bg, ink }
}

/** True when 6-digit hex `#rrggbb`. Used to validate user colour input. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim())
}
