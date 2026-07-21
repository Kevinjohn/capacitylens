// Product icon vocabulary backed by lucide-react. Icons use currentColor and a consistent
// default size. They are decorative (aria-hidden); icon-only buttons take their accessible
// name from the button's own aria-label at the call site, never from here.

import {
  Briefcase,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Folder,
  Pencil,
  Plus,
  Redo2,
  SlidersHorizontal,
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
  | 'briefcase'
  | 'calendar'
  | 'clipboard-check'
  | 'folder'
  | 'people'
  | 'sliders'
  | 'tag'

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
  briefcase: Briefcase,
  calendar: Calendar,
  'clipboard-check': ClipboardCheck,
  folder: Folder,
  people: Users,
  sliders: SlidersHorizontal,
  tag: Tag,
}

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const Glyph = ICONS[name]
  // lucide strokes with currentColor by default — leave colour to CSS so existing
  // className overrides still apply. aria-hidden + focusable=false keep the glyph
  // decorative; the button around it owns the accessible name.
  return <Glyph size={size} className={className} aria-hidden="true" focusable="false" />
}
