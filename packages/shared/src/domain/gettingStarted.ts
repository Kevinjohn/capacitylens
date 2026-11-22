import type { AppData } from '../types/entities.js';
import { isBuiltinClient } from '../data/internalClient.js';
import { resolveLifecycleStatus } from './lifecycle.js';

// Getting-started milestones from a company's active projection; the server sends the result.

/** Which getting-started steps the active account has completed. */
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
      .filter(
        (resource) => resolveLifecycleStatus(resource) === 'active' && resource.kind === 'person',
      )
      .map(({ id }) => id),
  );
  const clients = new Set(
    data.clients
      .filter((client) => resolveLifecycleStatus(client) === 'active')
      .map(({ id }) => id),
  );
  const gettingStartedClientIds = new Set(
    data.clients
      .filter((client) => resolveLifecycleStatus(client) === 'active' && !isBuiltinClient(client))
      .map(({ id }) => id),
  );
  const projects = new Map(
    data.projects
      .filter((project) => resolveLifecycleStatus(project) === 'active')
      .map((project) => [project.id, project]),
  );
  const isCoherentProject = (projectId: string | null | undefined): boolean => {
    if (!projectId) return false;
    const project = projects.get(projectId);
    return project !== undefined && clients.has(project.clientId);
  };
  const activities = new Map(
    data.activities
      .filter((activity) => resolveLifecycleStatus(activity) === 'active')
      .map((activity) => [activity.id, activity]),
  );
  const coherentActivities = new Map(
    [...activities.values()].map((activity) => [
      activity.id,
      activity.kind !== 'project' || isCoherentProject(activity.projectId),
    ]),
  );
  const scheduled = data.allocations.some((allocation) => {
    if (
      !people.has(allocation.resourceId) ||
      coherentActivities.get(allocation.activityId) !== true
    ) {
      return false;
    }
    const activity = activities.get(allocation.activityId);
    return (
      activity?.kind !== 'allProjects' ||
      allocation.projectId == null ||
      isCoherentProject(allocation.projectId)
    );
  });
  return {
    person: people.size > 0,
    client: gettingStartedClientIds.size > 0,
    project: [...projects.values()].some((project) =>
      gettingStartedClientIds.has(project.clientId),
    ),
    activity: [...coherentActivities.values()].some(Boolean),
    scheduled,
  };
}
