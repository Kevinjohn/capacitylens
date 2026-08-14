/**
 * Pure route/DOM contract shared by navigation, the orientation tour, and its browser regression.
 * Keep this module free of browser/i18n imports so Playwright can consume it directly.
 */
// Every sidebar destination's path, in nav order. The tour only spotlights some of them, but the
// whole set lives here so `navLinks.ts` never re-types a path as a literal: a route rename is one
// edit, and the spotlighted ones (used in TOUR_ANCHORS below) cannot drift out of the selectors.
export const ROUTE_SCHEDULE = "/";
export const ROUTE_RESOURCES = "/resources";
export const ROUTE_DISCIPLINES = "/disciplines";
export const ROUTE_CLIENTS = "/clients";
export const ROUTE_PROJECTS = "/projects";
export const ROUTE_ACTIVITIES = "/activities";
export const ROUTE_TIMEOFF = "/timeoff";
export const ROUTE_TEAM = "/team";
export const ROUTE_SETTINGS = "/settings";

export const TOUR_ANCHORS = [
  '[data-testid="scheduler-grid"]',
  '[data-testid="scheduler-toolbar"]',
  `[data-nav="${ROUTE_RESOURCES}"]`,
  `[data-nav="${ROUTE_CLIENTS}"]`,
  `[data-nav="${ROUTE_SETTINGS}"]`,
] as const;
