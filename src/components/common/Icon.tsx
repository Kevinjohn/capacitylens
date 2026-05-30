// Inline SVG icon set. Replaces the Unicode glyphs (✕ ↶ ↷ ‹ › ▸ ▾ ✓ +) that used
// to render at the mercy of whatever system font was installed — these draw with
// currentColor at a consistent 16px box and look identical on every platform.

export type IconName =
  | 'close'
  | 'undo'
  | 'redo'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'plus'

const PATHS: Record<IconName, string> = {
  close: 'M5 5l10 10M15 5L5 15',
  undo: 'M8 6L4 10l4 4M4 10h7a5 5 0 010 10H8',
  redo: 'M12 6l4 4-4 4M16 10H9a5 5 0 000 10h3',
  'chevron-left': 'M12.5 5l-5 5 5 5',
  'chevron-right': 'M7.5 5l5 5-5 5',
  'chevron-down': 'M5 7.5l5 5 5-5',
  check: 'M4 10.5l4 4 8-9',
  plus: 'M10 4v12M4 10h12',
}

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
