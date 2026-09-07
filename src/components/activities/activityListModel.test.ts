import { describe, expect, it } from "vitest";
import type { Activity, Client, Project } from "@capacitylens/shared/types/entities";
import { buildActivityListModel } from "./activityListModel";

interface ActivityInput {
  id: string;
  name: string;
  kind: Activity["kind"];
  projectId?: string | undefined;
}

const base = {
  accountId: "account",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

const client = (id: string, name: string): Client => ({ ...base, id, name, color: "#111111" });
const project = (id: string, name: string, clientId: string): Project => ({
  ...base,
  id,
  name,
  clientId,
  color: "#222222",
});
const activity = ({ id, name, kind, projectId }: ActivityInput): Activity => ({
  ...base,
  id,
  name,
  kind,
  ...(projectId ? { projectId } : {}),
});

describe("buildActivityListModel", () => {
  it("sorts every level without mutating storage order and keeps unresolved work in a final fallback", () => {
    const clients = [client("client-z", "Zulu Client"), client("client-a", "Alpha Client")];
    const projects = [
      project("project-z", "Zulu Project", "client-a"),
      project("project-a", "Alpha Project", "client-a"),
      project("project-other", "Other Project", "client-z"),
      project("project-missing-client", "Visible orphan project", "missing-client"),
    ];
    const activities = [
      activity({ id: "internal-z", name: "Zulu internal", kind: "internal" }),
      activity({ id: "project-z", name: "Zulu task", kind: "project", projectId: "project-a" }),
      activity({ id: "cross-10", name: "Workshop 10", kind: "repeatable" }),
      activity({ id: "project-a", name: "Alpha task", kind: "project", projectId: "project-a" }),
      activity({ id: "missing-project", name: "Still visible", kind: "project", projectId: "missing-project" }),
      activity({ id: "cross-2", name: "Workshop 2", kind: "repeatable" }),
      activity({
        id: "missing-client",
        name: "Visible orphan task",
        kind: "project",
        projectId: "project-missing-client",
      }),
      activity({ id: "internal-b", name: "Alpha internal", kind: "internal" }),
      activity({ id: "other-client", name: "Other client task", kind: "project", projectId: "project-other" }),
      activity({ id: "other-project", name: "Other project task", kind: "project", projectId: "project-z" }),
      activity({ id: "internal-a", name: "Alpha internal", kind: "internal" }),
    ];
    const storedOrder = activities.map(({ id }) => id);

    const model = buildActivityListModel({
      activities,
      projects,
      clients,
      unavailableClient: "Unavailable client",
      unavailableProject: "Unavailable project",
    });

    expect(model.kindOrder).toEqual(["internal", "repeatable", "project"]);
    expect(model.internal.map(({ id }) => id)).toEqual(["internal-a", "internal-b", "internal-z"]);
    expect(model.crossProject.map(({ name }) => name)).toEqual(["Workshop 2", "Workshop 10"]);
    expect(model.clients.map(({ name }) => name)).toEqual(["Alpha Client", "Zulu Client", "Unavailable client"]);
    expect(model.clients[0].projects.map(({ name }) => name)).toEqual(["Alpha Project", "Zulu Project"]);
    expect(model.clients[0].projects[0].activities.map(({ name }) => name)).toEqual(["Alpha task", "Zulu task"]);
    expect(model.clients[2].projects.map(({ name }) => name)).toEqual([
      "Visible orphan project",
      "Unavailable project",
    ]);
    expect(model.clients[2].projects.flatMap(({ activities: rows }) => rows.map(({ name }) => name))).toEqual([
      "Visible orphan task",
      "Still visible",
    ]);
    expect(activities.map(({ id }) => id)).toEqual(storedOrder);
  });
});
