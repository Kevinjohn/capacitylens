import type { Role } from "@capacitylens/shared/domain/access";
import { ROUTE_CLIENTS, ROUTE_RESOURCES, ROUTE_SETTINGS, ROUTE_TEAM } from "./tourAnchors";

/** Stable names for the role tour's ordered stops. */
/** Stable stop identity shared by role selection and translated tour copy. */
export type RoleTourStepId =
  | "owner-import"
  | "admin-invite"
  | "admin-example-data"
  | "editor-resources"
  | "editor-hierarchy"
  | "editor-book"
  | "viewer-grid"
  | "viewer-toolbar";

/** The route anchor and permission segment required to show a tour stop. */
/** A role-scoped tour anchor, independent of browser and translation capabilities. */
export interface RoleTourStep {
  readonly id: RoleTourStepId;
  readonly anchor: string;
  readonly segment: Role;
  readonly waitForElement?: number;
}

const roleOrder: Role[] = ["owner", "admin", "editor", "viewer"];

const allSteps: readonly RoleTourStep[] = [
  {
    id: "owner-import",
    anchor: `[data-nav="${ROUTE_SETTINGS}"]`,
    segment: "owner",
  },
  {
    id: "admin-invite",
    anchor: `[data-nav="${ROUTE_TEAM}"]`,
    segment: "admin",
  },
  {
    id: "admin-example-data",
    anchor: `[data-nav="${ROUTE_SETTINGS}"]`,
    segment: "admin",
  },
  {
    id: "editor-resources",
    anchor: `[data-nav="${ROUTE_RESOURCES}"]`,
    segment: "editor",
  },
  {
    id: "editor-hierarchy",
    anchor: `[data-nav="${ROUTE_CLIENTS}"]`,
    segment: "editor",
  },
  {
    id: "editor-book",
    anchor: '[data-testid="scheduler-grid"]',
    segment: "editor",
    waitForElement: 1000,
  },
  {
    id: "viewer-grid",
    anchor: '[data-testid="scheduler-grid"]',
    segment: "viewer",
    waitForElement: 1000,
  },
  {
    id: "viewer-toolbar",
    anchor: '[data-testid="scheduler-toolbar"]',
    segment: "viewer",
    waitForElement: 1000,
  },
];

/** Builds the tour from the caller's role down through the read-only schedule guidance. */
export function buildRoleTour({ role, serverMode }: { role: Role | null; serverMode: boolean }): RoleTourStep[] {
  const startIndex = role === null ? 0 : roleOrder.indexOf(role);
  return allSteps.filter((step) => {
    const segmentIndex = roleOrder.indexOf(step.segment);
    return segmentIndex >= startIndex && (serverMode || step.id !== "admin-example-data");
  });
}
