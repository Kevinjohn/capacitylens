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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { m } from '@/i18n';
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
} from './tourAnchors';

/** A route, deferred label getter, and icon used by sidebar navigation. Labels resolve at render time so switching account locale does not retain import-time text. */
export type NavigationLinkDefinition = { to: string; label: () => string; icon: LucideIcon };

/**
 * Which routes a member is shown in navigation. Route guards and the server decide access
 * independently; hiding a route here never authorizes or refuses anything.
 */
export type RouteVisibilityRule = 'everyone' | 'disciplines' | 'capacity-overview' | 'diagnostics';

/**
 * Where the sidebar places a route: the primary group, the administration group pinned to the
 * bottom, the session footer (Help and Account), or nowhere (reached from Help and the palette).
 */
export type RouteSidebarPlacement = 'primary' | 'admin' | 'footer' | 'none';

/** One application route with its navigation label, sidebar placement and visibility rule. */
export type AppRouteDefinition = NavigationLinkDefinition & {
  sidebar: RouteSidebarPlacement;
  visibility: RouteVisibilityRule;
};

/** The facts each {@link RouteVisibilityRule} is decided by for the current member. */
export interface RouteVisibilityContext {
  disciplinesEnabled: boolean;
  capacityOverviewAllowed: boolean;
  diagnosticsAllowed: boolean;
}

/** The shared Help destination rendered immediately above the personal Account footer row. */
export const HELP_LINK: AppRouteDefinition = {
  to: ROUTE_HELP,
  label: () => m.nav_help(),
  icon: CircleHelpIcon,
  sidebar: 'footer',
  visibility: 'everyone',
};

/** The personal account destination rendered in the sidebar session footer. */
export const ACCOUNT_LINK: AppRouteDefinition = {
  to: ROUTE_ACCOUNT,
  label: () => m.nav_account(),
  icon: UserRoundIcon,
  sidebar: 'footer',
  visibility: 'everyone',
};

// Share route constants with tour anchors so navigation and spotlight targets cannot drift.
/**
 * Every navigable application route, in sidebar and palette order. The sidebar, the command
 * palette and the document title all read from this table.
 *
 * Team & access and Settings are administration destinations, pinned to the bottom of the sidebar
 * below a separator: Team & access because it is role-gated in practice (most people never act
 * on it) and Settings because it is rarely visited. Diagnostics is an Owner/Admin support page
 * reached from Help and the palette rather than the sidebar.
 */
export const APP_ROUTES: readonly AppRouteDefinition[] = [
  {
    to: ROUTE_CAPACITY_OVERVIEW,
    label: () => m.nav_capacity_overview(),
    icon: ChartNoAxesColumnIncreasingIcon,
    sidebar: 'primary',
    visibility: 'capacity-overview',
  },
  {
    to: ROUTE_SCHEDULE,
    label: () => m.nav_schedule(),
    icon: CalendarIcon,
    sidebar: 'primary',
    visibility: 'everyone',
  },
  {
    to: ROUTE_RESOURCES,
    label: () => m.nav_resources(),
    icon: UsersIcon,
    sidebar: 'primary',
    visibility: 'everyone',
  },
  {
    to: ROUTE_DISCIPLINES,
    label: () => m.nav_disciplines(),
    icon: TagIcon,
    sidebar: 'primary',
    visibility: 'disciplines',
  },
  {
    to: ROUTE_CLIENTS,
    label: () => m.nav_clients(),
    icon: BriefcaseIcon,
    sidebar: 'primary',
    visibility: 'everyone',
  },
  {
    to: ROUTE_PROJECTS,
    label: () => m.nav_projects(),
    icon: FolderIcon,
    sidebar: 'primary',
    visibility: 'everyone',
  },
  {
    to: ROUTE_ACTIVITIES,
    label: () => m.nav_activities(),
    icon: ClipboardCheckIcon,
    sidebar: 'primary',
    visibility: 'everyone',
  },
  {
    to: ROUTE_TIMEOFF,
    label: () => m.nav_timeoff(),
    icon: SunIcon,
    sidebar: 'primary',
    visibility: 'everyone',
  },
  {
    to: ROUTE_TEAM,
    label: () => m.nav_team_access(),
    icon: ShieldCheckIcon,
    sidebar: 'admin',
    visibility: 'everyone',
  },
  {
    to: ROUTE_SETTINGS,
    label: () => m.nav_settings(),
    icon: SlidersHorizontalIcon,
    sidebar: 'admin',
    visibility: 'everyone',
  },
  {
    to: ROUTE_DIAGNOSTICS,
    label: () => m.nav_diagnostics(),
    icon: StethoscopeIcon,
    sidebar: 'none',
    visibility: 'diagnostics',
  },
  HELP_LINK,
  ACCOUNT_LINK,
];

/** Reports whether a route's visibility rule shows it in the given context. */
export function isRouteVisible(route: AppRouteDefinition, context: RouteVisibilityContext) {
  switch (route.visibility) {
    case 'everyone':
      return true;
    case 'disciplines':
      return context.disciplinesEnabled;
    case 'capacity-overview':
      return context.capacityOverviewAllowed;
    case 'diagnostics':
      return context.diagnosticsAllowed;
  }
}

/** Lists the routes from {@link APP_ROUTES} whose visibility rule shows them, in table order. */
export function listVisibleRoutes(context: RouteVisibilityContext): AppRouteDefinition[] {
  return APP_ROUTES.filter((route) => isRouteVisible(route, context));
}
