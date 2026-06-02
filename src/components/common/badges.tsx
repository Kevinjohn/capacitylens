import { isTemporary } from '@floaty/shared/lib/integrity'
import { ensureBarColors } from '@floaty/shared/lib/color'
import type { Resource } from '@floaty/shared/types/entities'

// Colour, avatar & resource-badge slice of the shared kit (re-exported from ./ui).
// Colours come from semantic tokens (see index.css), so everything adapts to dark mode.

export function TemporaryTag({ resource }: { resource: Resource }) {
  if (!isTemporary(resource)) return null
  return (
    <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-ink">
      Temp
    </span>
  )
}

export function ColorSwatch({ color }: { color: string }) {
  return <span className="inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-black/10" style={{ backgroundColor: color }} />
}

// Symbol shown on placeholder ("slot") avatars in place of initials.
// Kept as a constant so it's a one-line change when we revisit the treatment.
export const PLACEHOLDER_AVATAR_SYMBOL = '@'

export function Avatar({
  name,
  color,
  size = 28,
  placeholder = false,
}: {
  name: string
  color: string
  size?: number
  placeholder?: boolean
}) {
  const initials = placeholder
    ? PLACEHOLDER_AVATAR_SYMBOL
    : name
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || '—'
  // Keep the initials legible (white-on-mid-tone often fails AA) by nudging the fill.
  const { bg, ink } = ensureBarColors(color)
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, backgroundColor: bg, color: ink }}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-2xs font-semibold ring-2 ring-surface"
    >
      {initials}
    </span>
  )
}
