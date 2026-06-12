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
  // Sidebar navigation icons (one per section — see AppShell LINKS) plus the
  // rail toggle. Same hand-drawn stroke idiom as the rest of the set.
  | 'calendar'
  | 'people'
  | 'tag'
  | 'briefcase'
  | 'folder'
  | 'clipboard-check'
  | 'sun'
  | 'sliders'
  | 'panel-left'

const PATHS: Record<IconName, string> = {
  close: 'M5 5l10 10M15 5L5 15',
  undo: 'M8 6L4 10l4 4M4 10h7a5 5 0 010 10H8',
  redo: 'M12 6l4 4-4 4M16 10H9a5 5 0 000 10h3',
  'chevron-left': 'M12.5 5l-5 5 5 5',
  'chevron-right': 'M7.5 5l5 5-5 5',
  'chevron-down': 'M5 7.5l5 5 5-5',
  check: 'M4 10.5l4 4 8-9',
  plus: 'M10 4v12M4 10h12',
  calendar: 'M4.5 5.5h11v10h-11zM4.5 9h11M7.5 3.5v3M12.5 3.5v3',
  people:
    'M7.5 4.75a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 1 0 0-4.5M3.5 16.5c0-2.75 1.75-4.25 4-4.25s4 1.5 4 4.25M13.25 4.9a2.25 2.25 0 0 1 0 4.4M14.4 12.4c1.6.5 2.6 1.95 2.6 4.1',
  tag: 'M3.5 4.5h5.5l7 7-5.5 5.5-7-7zM6.75 7.25h.01',
  briefcase: 'M3.5 7.5h13V16h-13zM7.5 7.5v-2h5v2M3.5 11.5h13',
  folder: 'M3.5 15.5v-10h4.75l1.5 2h6.75v8z',
  'clipboard-check': 'M5 5h10v11.5H5zM7.5 5V3.5h5V5M7.5 11l1.75 1.75L13 9',
  sun: 'M10 7.25a2.75 2.75 0 1 0 0 5.5a2.75 2.75 0 1 0 0-5.5M10 3v1.75M10 15.25V17M3 10h1.75M15.25 10H17M5.05 5.05l1.25 1.25M13.7 13.7l1.25 1.25M14.95 5.05l-1.25 1.25M6.3 13.7l-1.25 1.25',
  sliders: 'M3.5 6h13M3.5 10h13M3.5 14h13M7.5 4.25v3.5M12.5 8.25v3.5M8.5 12.25v3.5',
  'panel-left': 'M3.5 4.5h13v11h-13zM7.75 4.5v11',
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
