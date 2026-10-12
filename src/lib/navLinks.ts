import {
  BriefcaseIcon,
  CalendarIcon,
  ChartNoAxesColumnIncreasingIcon,
  CircleHelpIcon,
  ClipboardCheckIcon,
  FolderIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  StethoscopeIcon,
  SunIcon,
  TagIcon,
  UsersIcon,
  UserRoundIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { m } from "@/i18n";
import {
  ROUTE_ACTIVITIES,
  ROUTE_ACCOUNT,
  ROUTE_CAPACITY_OVERVIEW,
  ROUTE_CLIENTS,
  ROUTE_DIAGNOSTICS,
  ROUTE_DISCIPLINES,
  ROUTE_HELP,
  ROUTE_PROJECTS,
  ROUTE_RESOURCES,
  ROUTE_SCHEDULE,
  ROUTE_SETTINGS,
  ROUTE_TEAM,
  ROUTE_TIMEOFF,
} from "./tourAnchors";

/** A route, deferred label getter, and icon used by sidebar navigation. Labels resolve at render time so switching account locale does not retain import-time text. */
export type NavigationLinkDefinition = { to: string; label: () => string; icon: LucideIcon };

// Share route constants with tour anchors so navigation and spotlight targets cannot drift.
/** Navigation links shown in the application sidebar. */
export const LINKS: NavigationLinkDefinition[] = [
  { to: ROUTE_CAPACITY_OVERVIEW, label: () => m.nav_capacity_overview(), icon: ChartNoAxesColumnIncreasingIcon },
  { to: ROUTE_SCHEDULE, label: () => m.nav_schedule(), icon: CalendarIcon },
  { to: ROUTE_RESOURCES, label: () => m.nav_resources(), icon: UsersIcon },

  { to: ROUTE_DISCIPLINES, label: () => m.nav_disciplines(), icon: TagIcon },
  { to: ROUTE_CLIENTS, label: () => m.nav_clients(), icon: BriefcaseIcon },
  { to: ROUTE_PROJECTS, label: () => m.nav_projects(), icon: FolderIcon },
  { to: ROUTE_ACTIVITIES, label: () => m.nav_activities(), icon: ClipboardCheckIcon },
  { to: ROUTE_TIMEOFF, label: () => m.nav_timeoff(), icon: SunIcon },
];

/**
 * Administration destinations, pinned to the bottom of the sidebar in their own group below a
 * separator. They are the same `NavigationLinkDefinition` shape and render through the same
 * menu markup as `LINKS`, only their placement differs. Team & access is here because it is
 * role-gated in practice (most people never act on it) and Settings because it is rarely visited:
 * neither should compete for the eye with the day-to-day scheduling destinations above. Diagnostics
 * is Owner/Admin-only; the sidebar and command palette drop it for other roles.
 */
export const ADMIN_LINKS: NavigationLinkDefinition[] = [
  { to: ROUTE_TEAM, label: () => m.nav_team_access(), icon: ShieldCheckIcon },
  { to: ROUTE_SETTINGS, label: () => m.nav_settings(), icon: SlidersHorizontalIcon },
  { to: ROUTE_DIAGNOSTICS, label: () => m.nav_diagnostics(), icon: StethoscopeIcon },
];

/** The personal account destination rendered in the sidebar session footer. */
export const ACCOUNT_LINK: NavigationLinkDefinition = {
  to: ROUTE_ACCOUNT,
  label: () => m.nav_account(),
  icon: UserRoundIcon,
};

/** The shared Help destination rendered immediately above the personal Account footer row. */
export const HELP_LINK: NavigationLinkDefinition = {
  to: ROUTE_HELP,
  label: () => m.nav_help(),
  icon: CircleHelpIcon,
};
