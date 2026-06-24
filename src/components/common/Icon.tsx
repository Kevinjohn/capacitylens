// Icon adapter over lucide-react. Every glyph that used to be a hand-drawn inline
// SVG (and before that a Unicode codepoint at the mercy of the system font) now maps
// to a lucide component, drawn with currentColor at a consistent 16px box. The public
// API — <Icon name=… size=… className=…/> — is unchanged, so no call site moved: the
// `name` union and prop shape are identical to the old map. Icons are decorative
// (aria-hidden); icon-only buttons take their accessible name from the button's own
// aria-label at the call site (e.g. the AppShell rail toggle), never from here.

import {
  Briefcase,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Folder,
  PanelLeft,
  Plus,
  Redo2,
  SlidersHorizontal,
  Sun,
  Tag,
  Undo2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'

export type IconName =
  | 'close'
  | 'undo'
  | 'redo'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'plus'
  // Sidebar navigation icons (one per section — see AppShell LINKS) plus the rail toggle.
  | 'calendar'
  | 'people'
  | 'tag'
  | 'briefcase'
  | 'folder'
  | 'clipboard-check'
  | 'sun'
  | 'sliders'
  | 'panel-left'

const ICONS: Record<IconName, LucideIcon> = {
  close: X,
  undo: Undo2,
  redo: Redo2,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  check: Check,
  plus: Plus,
  calendar: Calendar,
  people: Users,
  tag: Tag,
  briefcase: Briefcase,
  folder: Folder,
  'clipboard-check': ClipboardCheck,
  sun: Sun,
  sliders: SlidersHorizontal,
  'panel-left': PanelLeft,
}

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const Glyph = ICONS[name]
  // lucide strokes with currentColor by default — leave colour to CSS so existing
  // className overrides still apply. aria-hidden + focusable=false keep the glyph
  // decorative; the button around it owns the accessible name.
  return <Glyph size={size} className={className} aria-hidden="true" focusable="false" />
}
