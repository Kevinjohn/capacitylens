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
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { m } from "@/i18n";
import {
  ROUTE_ACTIVITIES,
  ROUTE_ACCOUNT,
  ROUTE_CLIENTS,
  ROUTE_DISCIPLINES,
  ROUTE_PROJECTS,
  ROUTE_RESOURCES,
  ROUTE_SCHEDULE,
  ROUTE_SETTINGS,
  ROUTE_TEAM,
  ROUTE_TIMEOFF,
} from "./tourAnchors";

/**
 * A nav destination: `[route, labelFn, icon]`. The label is a **getter** (`() => m.nav_x()`), not a
 * pre-resolved string, so each destination's text is resolved at RENDER (inside the `navLinks.map`
 * site in AppSidebar) rather than at module load. That matters for i18n (P1.5.2): `LINKS` is
 * module-scope, and calling `m.nav_x()` here would freeze the label to the locale active at import
 * — the getter defers it to render so a locale switch (account change) re-resolves the text on the
 * next render.
 */
export type NavigationLinkDefinition = { to: string; label: () => string; icon: LucideIcon };

// Every route path below is single-sourced in tourAnchors.ts, so a route rename is ONE edit. That
// matters most for the destinations the "Show me around" tour spotlights via `[data-nav="<route>"]`
// — a drifting path would silently un-anchor its spotlight step (driver.js degrades a
// missing-element step to a centred popover; getting-started.spec.ts pins every exported tour
// anchor to a real element in the rendered schedule) — but the rest use the constants too so no
// reader has to work out which literals are load-bearing.
export const LINKS: NavigationLinkDefinition[] = [
  { to: ROUTE_SCHEDULE, label: () => m.nav_schedule(), icon: CalendarIcon },
  { to: ROUTE_RESOURCES, label: () => m.nav_resources(), icon: UsersIcon },
  // External / 3rd parties moved INTO the Resources tab behind a per-account setting
  // (`externalEnabled` on the Account, default off — Settings → External). They no longer have their
  // own nav link; the old /external route redirects to /resources for saved bookmarks.
  { to: ROUTE_DISCIPLINES, label: () => m.nav_disciplines(), icon: TagIcon },
  { to: ROUTE_CLIENTS, label: () => m.nav_clients(), icon: BriefcaseIcon },
  { to: ROUTE_PROJECTS, label: () => m.nav_projects(), icon: FolderIcon },
  { to: ROUTE_ACTIVITIES, label: () => m.nav_activities(), icon: ClipboardCheckIcon },
  { to: ROUTE_TIMEOFF, label: () => m.nav_timeoff(), icon: SunIcon },
];

/**
 * Administration destinations, pinned to the BOTTOM of the sidebar in their own group below a
 * separator (issues #169 / #172). They are the same `NavigationLinkDefinition` shape and render through the same
 * menu markup as `LINKS` — only their placement differs. Team & access is here because it is
 * role-gated in practice (most people never act on it) and Settings because it is rarely visited:
 * neither should compete for the eye with the day-to-day scheduling destinations above.
 */
export const ADMIN_LINKS: NavigationLinkDefinition[] = [
  { to: ROUTE_TEAM, label: () => m.nav_team_access(), icon: ShieldCheckIcon },
  { to: ROUTE_SETTINGS, label: () => m.nav_settings(), icon: SlidersHorizontalIcon },
];

/** The personal account destination rendered in the sidebar session footer. */
export const ACCOUNT_LINK: NavigationLinkDefinition = {
  to: ROUTE_ACCOUNT,
  label: () => m.nav_account(),
  icon: UserRoundIcon,
};
