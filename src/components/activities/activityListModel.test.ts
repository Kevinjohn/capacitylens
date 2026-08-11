import { describe, expect, it } from "vitest";
import type { Activity, Client, Project } from "@capacitylens/shared/types/entities";
import { buildActivityListModel } from "./activityListModel";

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
const activity = (id: string, name: string, kind: Activity["kind"], projectId?: string): Activity => ({
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
      activity("internal-z", "Zulu internal", "internal"),
      activity("project-z", "Zulu task", "project", "project-a"),
      activity("cross-10", "Workshop 10", "repeatable"),
      activity("project-a", "Alpha task", "project", "project-a"),
      activity("missing-project", "Still visible", "project", "missing-project"),
      activity("cross-2", "Workshop 2", "repeatable"),
      activity("missing-client", "Visible orphan task", "project", "project-missing-client"),
      activity("internal-b", "Alpha internal", "internal"),
      activity("other-client", "Other client task", "project", "project-other"),
      activity("other-project", "Other project task", "project", "project-z"),
      activity("internal-a", "Alpha internal", "internal"),
    ];
    const storedOrder = activities.map(({ id }) => id);

    const model = buildActivityListModel({
      activities,
      projects,
      clients,
      unavailableClient: "Unavailable client",
      unavailableProject: "Unavailable project",
    });

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
