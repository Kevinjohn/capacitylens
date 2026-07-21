// Product icon vocabulary backed by lucide-react. Icons use currentColor and a consistent
// default size. They are decorative
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
  Eye,
  Folder,
  PanelLeft,
  Pencil,
  Plus,
  Redo2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Tag,
  Trash2,
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
  // Row-action glyphs for the management lists (Edit/Delete buttons go icon-only — the
  // button's aria-label carries the accessible name, see EditButton/DeleteButton in ./dialogs).
  | 'edit'
  | 'delete'
  // Sidebar navigation icons (one per section — see AppShell LINKS) plus the rail toggle.
  | 'calendar'
  | 'people'
  | 'tag'
  | 'briefcase'
  | 'folder'
  | 'clipboard-check'
  | 'sun'
  | 'sliders'
  | 'shield-check'
  | 'panel-left'
  // Read-only "View only" badge in the sidebar footer.
  | 'eye'

const ICONS: Record<IconName, LucideIcon> = {
  close: X,
  undo: Undo2,
  redo: Redo2,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  check: Check,
  plus: Plus,
  edit: Pencil,
  delete: Trash2,
  calendar: Calendar,
  people: Users,
  tag: Tag,
  briefcase: Briefcase,
  folder: Folder,
  'clipboard-check': ClipboardCheck,
  sun: Sun,
  sliders: SlidersHorizontal,
  'shield-check': ShieldCheck,
  'panel-left': PanelLeft,
  eye: Eye,
}

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const Glyph = ICONS[name]
  // lucide strokes with currentColor by default — leave colour to CSS so existing
  // className overrides still apply. aria-hidden + focusable=false keep the glyph
  // decorative; the button around it owns the accessible name.
  return <Glyph size={size} className={className} aria-hidden="true" focusable="false" />
}
