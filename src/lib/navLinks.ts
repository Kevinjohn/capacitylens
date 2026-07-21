import {
  BriefcaseIcon,
  CalendarIcon,
  ClipboardCheckIcon,
  FolderIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SunIcon,
  TagIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { m } from '@/i18n'

/**
 * A nav destination: `[route, labelFn, icon]`. The label is a **getter** (`() => m.nav_x()`), not a
 * pre-resolved string, so each destination's text is resolved at RENDER (inside the `navLinks.map`
 * site in AppSidebar) rather than at module load. That matters for i18n (P1.5.2): `LINKS` is
 * module-scope, and calling `m.nav_x()` here would freeze the label to the locale active at import
 * — the getter defers it to render so a locale switch (account change) re-resolves the text on the
 * next render.
 */
export type NavLinkDef = [to: string, label: () => string, icon: LucideIcon]

// Route path constants for the three sidebar destinations the "Show me around" tour (lib/tour.ts)
// spotlights via `[data-nav="<route>"]`. Single-sourced here (and used to build `LINKS` below) so a
// route rename is ONE edit — otherwise it would silently un-anchor the tour's spotlight steps
// (driver.js degrades a missing-element step to a centred popover, and no test catches it).
export const ROUTE_RESOURCES = '/resources'
export const ROUTE_TEAM = '/team'
export const ROUTE_CLIENTS = '/clients'
export const ROUTE_SETTINGS = '/settings'

export const LINKS: NavLinkDef[] = [
  ['/', () => m.nav_schedule(), CalendarIcon],
  [ROUTE_RESOURCES, () => m.nav_resources(), UsersIcon],
  [ROUTE_TEAM, () => m.nav_team_access(), ShieldCheckIcon],
  // External / 3rd parties moved INTO the Resources tab behind a per-account setting
  // (`externalEnabled` on the Account, default off — Settings → External). They no longer have their
  // own nav link; the old /external route redirects to /resources for saved bookmarks.
  ['/disciplines', () => m.nav_disciplines(), TagIcon],
  [ROUTE_CLIENTS, () => m.nav_clients(), BriefcaseIcon],
  ['/projects', () => m.nav_projects(), FolderIcon],
  ['/activities', () => m.nav_activities(), ClipboardCheckIcon],
  ['/timeoff', () => m.nav_timeoff(), SunIcon],
  [ROUTE_SETTINGS, () => m.nav_settings(), SlidersHorizontalIcon],
]
