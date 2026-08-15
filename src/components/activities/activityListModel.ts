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
  return compareDisplayNames(left.name, leftKey, right.name, rightKey);
}

function compareGroups<T extends NamedEntity & { unavailable: boolean }>(left: T, right: T): number {
  return Number(left.unavailable) - Number(right.unavailable) || compareNamed(left, right);
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
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const groupedClients = new Map<string, ClientActivityGroup>();

  for (const activity of activities) {
    if (activity.kind !== "project") continue;

    const project = activity.projectId ? projectById.get(activity.projectId) : undefined;
    const client = project ? clientById.get(project.clientId) : undefined;
    const clientKey = client ? `client:${client.id}` : "client:unavailable";
    const projectKey = project ? `project:${project.id}` : "project:unavailable";
    let clientGroup = groupedClients.get(clientKey);
    if (!clientGroup) {
      clientGroup = {
        key: clientKey,
        name: client?.name ?? unavailableClient,
        unavailable: !client,
        projects: [],
      };
      groupedClients.set(clientKey, clientGroup);
    }

    let projectGroup = clientGroup.projects.find((group) => group.key === projectKey);
    if (!projectGroup) {
      projectGroup = {
        key: projectKey,
        name: project?.name ?? unavailableProject,
        unavailable: !project,
        activities: [],
      };
      clientGroup.projects.push(projectGroup);
    }
    projectGroup.activities.push(activity);
  }

  const sortedActivities = (kind: Activity["kind"]) =>
    activities.filter((activity) => activity.kind === kind).toSorted(compareNamed);

  return {
    kindOrder: ACTIVITY_KIND_ORDER,
    internal: sortedActivities("internal"),
    crossProject: sortedActivities("repeatable"),
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
