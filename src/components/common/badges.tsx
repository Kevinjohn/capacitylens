import { ensureBarColors } from '@capacitylens/shared/lib/color'
import { Avatar as ShadAvatar, AvatarFallback, AvatarImage } from '../ui/avatar'

// CapacityLens colour and avatar compositions.

export function ColorSwatch({ color }: { color: string }) {
  return <span className="inline-block size-3 rounded-sm ring-1 ring-inset ring-black/10" style={{ backgroundColor: color }} />
}

// Placeholder avatars use a question mark instead of initials. The display name lives in
// src/lib/metadata.ts because this module is a React component boundary.
export const PLACEHOLDER_AVATAR_SYMBOL = '?'

export function Avatar({
  name,
  color,
  size = 28,
  placeholder = false,
  imageUrl,
}: {
  name: string
  color: string
  size?: number
  placeholder?: boolean
  /** The signed-in user's own avatar (SSO `picture`). When set, the photo renders over the
   *  initials; the Radix primitive keeps the initials as the fallback while it loads and on error. */
  imageUrl?: string
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
    <ShadAvatar
      aria-hidden
      style={{ width: size, height: size, backgroundColor: bg, color: ink }}
      className="ring-2 ring-surface"
    >
      {imageUrl && <AvatarImage src={imageUrl} alt="" />}
      <AvatarFallback className="bg-transparent text-2xs font-semibold text-inherit">
        {initials}
      </AvatarFallback>
    </ShadAvatar>
  )
}
