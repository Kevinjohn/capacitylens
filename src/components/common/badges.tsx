import { isTemporary } from '@capacitylens/shared/lib/integrity'
import { ensureBarColors } from '@capacitylens/shared/lib/color'
import type { Resource } from '@capacitylens/shared/types/entities'
import { Badge } from '../ui/badge'
import { m } from '@/i18n'

// Colour, avatar & resource-badge slice of the shared kit (re-exported from ./ui).
// Colours come from semantic tokens (see index.css), so everything adapts to dark mode.

// Currently rendered nowhere by product decision: employment type is captured on the form, but
// the roster and schedule do not add a temporary-worker badge (DECISIONS.md).
export function TemporaryTag({ resource }: { resource: Resource }) {
  if (!isTemporary(resource)) return null
  // Retained as a ready-made presentation primitive if that standing product decision changes.
  return (
    <Badge variant="warn" className="rounded-sm px-1 py-0 text-[9px] leading-[13px] font-semibold uppercase">
      {m.badge_temporary()}
    </Badge>
  )
}

export function ColorSwatch({ color }: { color: string }) {
  return <span className="inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-black/10" style={{ backgroundColor: color }} />
}

// Symbol shown on placeholder ("slot") avatars in place of initials — a question mark, reading as
// "an as-yet-unfilled slot". Kept as a constant so it's a one-line change when we revisit the
// treatment. (The placeholder feature itself is gated behind the per-account
// `placeholdersEnabled` setting on the Account, default off — see selectors.ts / DECISIONS.md.)
// The placeholder DISPLAY NAME ("Placeholder") lives in src/lib/metadata.ts (a non-component
// module) — react-refresh forbids a non-component function export from this file.
export const PLACEHOLDER_AVATAR_SYMBOL = '?'

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
