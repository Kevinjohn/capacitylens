/**
 * Pure route/DOM contract shared by navigation, the orientation tour, and its browser regression.
 * Keep this module free of browser/i18n imports so Playwright can consume it directly.
 */
export const ROUTE_RESOURCES = "/resources";
export const ROUTE_TEAM = "/team";
export const ROUTE_CLIENTS = "/clients";
export const ROUTE_SETTINGS = "/settings";

export const TOUR_ANCHORS = [
  '[data-testid="scheduler-grid"]',
  '[data-testid="scheduler-toolbar"]',
  `[data-nav="${ROUTE_RESOURCES}"]`,
  `[data-nav="${ROUTE_CLIENTS}"]`,
  `[data-nav="${ROUTE_SETTINGS}"]`,
] as const;
