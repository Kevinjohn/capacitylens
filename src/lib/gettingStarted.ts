import type { AppData } from "@capacitylens/shared/types/entities";
import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { lifecycleStatus } from "@capacitylens/shared/domain/lifecycle";

// Pure derivation for the first-run "Getting started" checklist (components/GettingStarted.tsx):
// which useful first-use outcomes the active account has completed, read straight off scoped data.
// Kept out of the component file so it's a plain testable function (and mutation-tested with the
// other src/lib helpers).

/** Which onboarding steps the active account has completed. */
export interface GettingStartedSteps {
  person: boolean;
  client: boolean;
  project: boolean;
  activity: boolean;
  scheduled: boolean;
}

/**
 * Derive checklist completion from an account's active-only scoped {@link AppData}.
 *
 * Production callers pass the active projection, while lifecycle checks here keep the pure
 * contract safe for imported or independently constructed data. Activity ancestry and every
 * allocation reference are verified rather than inferred from row presence.
 */
export function buildGettingStartedSteps(data: AppData): GettingStartedSteps {
  const people = new Set(
    data.resources
      .filter((resource) => lifecycleStatus(resource) === "active" && resource.kind === "person")
      .map(({ id }) => id),
  );
  const clients = new Set(data.clients.filter((client) => lifecycleStatus(client) === "active").map(({ id }) => id));
  const onboardingClientIds = new Set(
    data.clients
      .filter((client) => lifecycleStatus(client) === "active" && !isBuiltinClient(client))
      .map(({ id }) => id),
  );
  const projects = new Map(
    data.projects.filter((project) => lifecycleStatus(project) === "active").map((project) => [project.id, project]),
  );
  const coherentProject = (projectId: string | undefined): boolean => {
    if (!projectId) return false;
    const project = projects.get(projectId);
    return project !== undefined && clients.has(project.clientId);
  };
  const activities = new Map(
    data.activities
      .filter((activity) => lifecycleStatus(activity) === "active")
      .map((activity) => [activity.id, activity]),
  );
  const coherentActivities = new Map(
    [...activities.values()].map((activity) => [
      activity.id,
      activity.kind !== "project" || coherentProject(activity.projectId),
    ]),
  );
  const scheduled = data.allocations.some((allocation) => {
    if (!people.has(allocation.resourceId) || coherentActivities.get(allocation.activityId) !== true) return false;
    const activity = activities.get(allocation.activityId);
    return (
      activity?.kind !== "repeatable" || allocation.projectId === undefined || coherentProject(allocation.projectId)
    );
  });
  return {
    person: people.size > 0,
    client: onboardingClientIds.size > 0,
    project: [...projects.values()].some((project) => onboardingClientIds.has(project.clientId)),
    activity: [...coherentActivities.values()].some(Boolean),
    scheduled,
  };
}

/**
 * Decide whether all five company-data milestones are complete.
 */
export function isGettingStartedComplete(steps: GettingStartedSteps): boolean {
  return hasCompletedAllSteps(steps);
}

/** Whether every step is complete. `Object.values(...).every(Boolean)`
 *  is exhaustive BY CONSTRUCTION over {@link GettingStartedSteps}' fields — unlike a hand-enumerated
 *  `steps.a && steps.b && ...`, adding a fifth step here can't silently compile against a stale
 *  list and hide the card too early. */
export function hasCompletedAllSteps(steps: GettingStartedSteps): boolean {
  return Object.values(steps).every(Boolean);
}
