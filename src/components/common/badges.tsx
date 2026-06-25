import { isTemporary } from '@floaty/shared/lib/integrity'
import { ensureBarColors } from '@floaty/shared/lib/color'
import type { Resource } from '@floaty/shared/types/entities'
import { Badge } from '../ui/badge'

// Colour, avatar & resource-badge slice of the shared kit (re-exported from ./ui).
// Colours come from semantic tokens (see index.css), so everything adapts to dark mode.

// PARKED — currently rendered nowhere. The Temp pill was pulled from the schedule and
// the Resources list pending a proper treatment for freelancers / contractors / external
// suppliers (see NEEDS-INPUT.md "Parked"). Employment type is still captured on the form;
// this stays so re-introducing a (redesigned) marker is a one-line change per call site.
export function TemporaryTag({ resource }: { resource: Resource }) {
  if (!isTemporary(resource)) return null
  // Reshaped onto the shadcn Badge `warn` variant (Phase 8) — its tokens (border-warn/40 +
  // bg-warn/10 + text-ink) are floaty's amber chip, the SAME treatment this carried before, so
  // the look is unchanged. Safe to reshape: this tag is currently rendered nowhere (parked; see
  // the note above). The extra-compact sizing (text-[9px], uppercase) is kept via className so the
  // pill stays the small marker it was when re-introduced.
  return (
    <Badge variant="warn" className="rounded-sm px-1 py-0 text-[9px] leading-[13px] font-semibold uppercase">
      Temp
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
