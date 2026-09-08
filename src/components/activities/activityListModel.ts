import type { Activity, Client, Project } from "@capacitylens/shared/types/entities";
import { compareDisplayNames } from "../../lib/displayOrder";
import { ACTIVITY_KIND_ORDER } from "./activityKinds";

type NamedEntity = { name: string } & ({ id: string } | { key: string });

interface ProjectActivityGroup {
  key: string;
  name: string;
  unavailable: boolean;
  activities: Activity[];
}

interface ClientActivityGroup {
  key: string;
  name: string;
  unavailable: boolean;
  projects: ProjectActivityGroup[];
}

interface ActivityListModel {
  kindOrder: typeof ACTIVITY_KIND_ORDER;
  internal: Activity[];
  crossProject: Activity[];
  clients: ClientActivityGroup[];
}

function compareNamed(left: NamedEntity, right: NamedEntity): number {
  const leftKey = "id" in left ? left.id : left.key;
  const rightKey = "id" in right ? right.id : right.key;
  return compareDisplayNames({ leftName: left.name, leftId: leftKey, rightName: right.name, rightId: rightKey });
}

function compareGroups<T extends NamedEntity & { unavailable: boolean }>(left: T, right: T): number {
  return Number(left.unavailable) - Number(right.unavailable) || compareNamed(left, right);
}

function getClientGroup(
  groupedClients: Map<string, ClientActivityGroup>,
  client: Client | undefined,
  unavailableClient: string,
): ClientActivityGroup {
  const key = client ? `client:${client.id}` : "client:unavailable";
  const existing = groupedClients.get(key);
  if (existing) return existing;

  const group = { key, name: client?.name ?? unavailableClient, unavailable: !client, projects: [] };
  groupedClients.set(key, group);
  return group;
}

function getProjectGroup(
  clientGroup: ClientActivityGroup,
  project: Project | undefined,
  unavailableProject: string,
): ProjectActivityGroup {
  const key = project ? `project:${project.id}` : "project:unavailable";
  const existing = clientGroup.projects.find((group) => group.key === key);
  if (existing) return existing;

  const group = { key, name: project?.name ?? unavailableProject, unavailable: !project, activities: [] };
  clientGroup.projects.push(group);
  return group;
}

/** Build the Activities page's view-only ordering without mutating the scoped store arrays. */
export function buildActivityListModel({
  activities,
  projects,
  clients,
  unavailableClient,
  unavailableProject,
}: {
  activities: Activity[];
  projects: Project[];
  clients: Client[];
  unavailableClient: string;
  unavailableProject: string;
}): ActivityListModel {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const groupedClients = new Map<string, ClientActivityGroup>();

  for (const activity of activities) {
    if (activity.kind !== "project") continue;

    const project = activity.projectId ? projectsById.get(activity.projectId) : undefined;
    const client = project ? clientsById.get(project.clientId) : undefined;
    const clientGroup = getClientGroup(groupedClients, client, unavailableClient);
    const projectGroup = getProjectGroup(clientGroup, project, unavailableProject);
    projectGroup.activities.push(activity);
  }

  const listSortedActivities = (kind: Activity["kind"]) =>
    activities.filter((activity) => activity.kind === kind).toSorted(compareNamed);

  return {
    kindOrder: ACTIVITY_KIND_ORDER,
    internal: listSortedActivities("internal"),
    crossProject: listSortedActivities("repeatable"),
    clients: [...groupedClients.values()]
      .map((client) => ({
        ...client,
        projects: client.projects
          .map((project) => ({ ...project, activities: project.activities.toSorted(compareNamed) }))
          .toSorted(compareGroups),
      }))
      .toSorted(compareGroups),
  };
}
