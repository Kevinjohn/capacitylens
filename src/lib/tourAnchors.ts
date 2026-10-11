/**
 * Pure route/DOM contract shared by navigation, the orientation tour, and its browser regression.
 * Keep this module free of browser/i18n imports so Playwright can consume it directly.
 */
// Every sidebar destination's path, in nav order. The tour only spotlights some of them, but the
// whole set lives here so `navLinks.ts` never re-types a path as a literal: a route rename is one
// edit, and the spotlighted ones (used in TOUR_ANCHORS below) cannot drift out of the selectors.
/** Route path for the main schedule page. */
export const ROUTE_SCHEDULE = "/";
/** Route path for the capacity overview. */
export const ROUTE_CAPACITY_OVERVIEW = "/overview";
/** Route path for the resource list. */
export const ROUTE_RESOURCES = "/resources";
/** Route path for the discipline list. */
export const ROUTE_DISCIPLINES = "/disciplines";
/** Route path for the client list. */
export const ROUTE_CLIENTS = "/clients";
/** Route path for the project list. */
export const ROUTE_PROJECTS = "/projects";
/** Route path for the activity list. */
export const ROUTE_ACTIVITIES = "/activities";
/** Route path for time off. */
export const ROUTE_TIMEOFF = "/timeoff";
/** Route path for team access. */
export const ROUTE_TEAM = "/team";
/** Route path for settings. */
export const ROUTE_SETTINGS = "/settings";
/** Route path for diagnostics. */
export const ROUTE_DIAGNOSTICS = "/diagnostics";
/** Route path for the signed-in person's account page. */
export const ROUTE_ACCOUNT = "/account";
/** Route path for the shared Help page and its role-aware tour launcher. */
export const ROUTE_HELP = "/help";

/** Stable selectors used to position product-orientation tour steps. */
export const TOUR_ANCHORS = [
  '[data-testid="scheduler-grid"]',
  '[data-testid="scheduler-toolbar"]',
  `[data-nav="${ROUTE_RESOURCES}"]`,
  `[data-nav="${ROUTE_CLIENTS}"]`,
  `[data-nav="${ROUTE_SETTINGS}"]`,
  `[data-nav="${ROUTE_TEAM}"]`,
] as const;
