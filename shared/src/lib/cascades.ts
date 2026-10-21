import type { AppData, ID } from "../types/entities";

// Cascades return a new AppData without mutating the input.
// Entity IDs are table-global; callers must first authorize the root within its account.
// FK-clearing cascades require a revision so sync observes surviving relationship changes.
// Account deletion removes scoped rows by accountId rather than by an entity subtree.

/** Delete a resource and its allocations + time off. Pure, returns a new AppData. */
export function deleteResourceCascade(data: AppData, resourceId: ID): AppData {
  return {
    ...data,
    resources: data.resources.filter((resource) => resource.id !== resourceId),
    allocations: data.allocations.filter((allocation) => allocation.resourceId !== resourceId),
    timeOff: data.timeOff.filter((timeOff) => timeOff.resourceId !== resourceId),
  };
}

/** Delete an activity and its allocations. Pure, returns a new AppData. */
export function deleteActivityCascade(data: AppData, activityId: ID): AppData {
  return {
    ...data,
    activities: data.activities.filter((activity) => activity.id !== activityId),
    allocations: data.allocations.filter((allocation) => allocation.activityId !== activityId),
  };
}

/** Deleting a phase is non-destructive to its activities. It just ungroups them. */
export function deletePhaseCascade(data: AppData, phaseId: ID, updatedAt: string): AppData {
  return {
    ...data,
    phases: data.phases.filter((phase) => phase.id !== phaseId),
    activities: data.activities.map((activity) => {
      if (activity.phaseId !== phaseId) return activity;
      const remaining = { ...activity };
      delete remaining.phaseId;
      return { ...remaining, updatedAt };
    }),
  };
}

// Share project-subtree traversal so client and project deletion apply identical cascade rules.
// Collect removed IDs before filtering each table once.
// Clear surviving activity and placeholder references to removed parents to avoid dangling links.
function dropProjectSubtree(data: AppData, removedProjectIds: Set<ID>, updatedAt: string): AppData {
  const removedPhaseIds = new Set(
    data.phases.filter((phase) => removedProjectIds.has(phase.projectId)).map((phase) => phase.id),
  );
  const removedActivityIds = new Set(
    data.activities
      .filter((activity) => activity.projectId !== undefined && removedProjectIds.has(activity.projectId))
      .map((activity) => activity.id),
  );
  return {
    ...data,
    projects: data.projects.filter((project) => !removedProjectIds.has(project.id)),
    phases: data.phases.filter((phase) => !removedPhaseIds.has(phase.id)),
    activities: data.activities
      .filter((activity) => !removedActivityIds.has(activity.id))
      .map((activity) => {
        if (activity.phaseId === undefined || !removedPhaseIds.has(activity.phaseId)) return activity;
        const remaining = { ...activity };
        delete remaining.phaseId;
        return { ...remaining, updatedAt };
      }),
    allocations: data.allocations
      .filter((allocation) => !removedActivityIds.has(allocation.activityId))
      .map((allocation) => {
        if (allocation.projectId === undefined || !removedProjectIds.has(allocation.projectId)) return allocation;
        const remaining = { ...allocation };
        delete remaining.projectId;
        return { ...remaining, updatedAt };
      }),
    resources: data.resources.map((resource) => {
      if (resource.projectId === undefined || !removedProjectIds.has(resource.projectId)) return resource;
      const remaining = { ...resource };
      delete remaining.projectId;
      return { ...remaining, updatedAt };
    }),
  };
}

/** Delete a project subtree and its allocations.
 * Surviving activity phase links and matching project links are cleared.
 * Returns a new `AppData`.
 */
export function deleteProjectCascade(data: AppData, projectId: ID, updatedAt: string): AppData {
  return dropProjectSubtree(data, new Set([projectId]), updatedAt);
}

/** Delete a client and its project subtree.
 * Surviving activity phase links and matching project links are cleared.
 * Returns a new `AppData`.
 */
export function deleteClientCascade(data: AppData, clientId: ID, updatedAt: string): AppData {
  const removedProjectIds = new Set(
    data.projects.filter((project) => project.clientId === clientId).map((project) => project.id),
  );
  return {
    ...dropProjectSubtree(data, removedProjectIds, updatedAt),
    clients: data.clients.filter((client) => client.id !== clientId),
  };
}

/** Deleting a discipline ungroups its resources rather than deleting them. */
export function deleteDisciplineCascade(data: AppData, disciplineId: ID, updatedAt: string): AppData {
  return {
    ...data,
    disciplines: data.disciplines.filter((discipline) => discipline.id !== disciplineId),
    resources: data.resources.map((resource) => {
      if (resource.disciplineId !== disciplineId) return resource;
      const remaining = { ...resource };
      delete remaining.disciplineId;
      return { ...remaining, updatedAt };
    }),
  };
}
