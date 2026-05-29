import type { Allocation, AppData } from '../types/entities'

const FALLBACK = '#9ca3af'

// Bars are coloured by their project (matching Float), falling back to the
// client colour, then the resource colour, then a neutral grey — so a bar is
// always visible even if some relation is missing.
export function resolveBarColor(allocation: Allocation, data: AppData): string {
  const task = data.tasks.find((t) => t.id === allocation.taskId)
  const project = task ? data.projects.find((p) => p.id === task.projectId) : undefined
  if (project?.color) return project.color

  const client = project ? data.clients.find((c) => c.id === project.clientId) : undefined
  if (client?.color) return client.color

  const resource = data.resources.find((r) => r.id === allocation.resourceId)
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
  if (c.length < 6) return null
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
