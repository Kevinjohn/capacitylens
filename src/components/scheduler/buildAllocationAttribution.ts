import { effectiveProjectId } from "@capacitylens/shared/lib/integrity";
import type { Activity, Allocation, Client, ID, Project } from "@capacitylens/shared/types/entities";

export interface AllocationAttribution {
  projectId: ID | undefined;
  project: Project | undefined;
  client: Client | undefined;
}

export function buildAllocationAttribution({
  allocation,
  activitiesById,
  projectsById,
  clientsById,
  internalClient,
}: {
  allocation: Allocation;
  activitiesById: Map<ID, Activity>;
  projectsById: Map<ID, Project>;
  clientsById: Map<ID, Client>;
  internalClient: Client | undefined;
}): AllocationAttribution {
  const activity = activitiesById.get(allocation.activityId);
  const projectId = effectiveProjectId(allocation, activity ?? {});
  const project = projectId ? projectsById.get(projectId) : undefined;
  let client: Client | undefined;
  if (project) client = clientsById.get(project.clientId);
  else if (!projectId && activity) client = internalClient;
  return { projectId, project, client };
}
