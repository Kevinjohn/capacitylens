import { describe, expect, it } from "vitest";
import { emptyAppData } from "../../types/entities.js";
import {
  FIXTURE_CLIENT,
  FIXTURE_PROJECT,
  FIXTURE_RESOURCE,
  FIXTURE_ACTIVITY,
  FIXTURE_PHASE,
} from "../../data/fixtures.js";
import { archiveRecovery } from "./archiveRecovery.js";
function requireFixture<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected archive recovery fixture row");
  return value;
}

const accountId = "a-studio";
const archivedAt = "2026-10-01T00:00:00.000Z";
function fixture() {
  const data = emptyAppData();
  data.clients = [
    {
      ...FIXTURE_CLIENT,
      accountId,
      id: "client",
      name: "Secret client",
      isPrivate: true,
      codeName: "Wayne",
      archivedAt,
      deletedAt: null,
    },
  ];
  data.projects = [
    {
      ...FIXTURE_PROJECT,
      accountId,
      id: "project",
      clientId: "client",
      name: "Secret project",
      isPrivate: true,
      codeName: "Gotham",
      archivedAt,
      deletedAt: null,
    },
  ];
  data.phases = [{ ...FIXTURE_PHASE, accountId, id: "phase", projectId: "project" }];
  data.activities = [
    {
      ...FIXTURE_ACTIVITY,
      accountId,
      id: "activity",
      name: "Research",
      projectId: null,
      phaseId: "phase",
      archivedAt: null,
      deletedAt: null,
    },
  ];
  data.resources = [
    {
      ...FIXTURE_RESOURCE,
      accountId,
      id: "person",
      name: "Bruce Wayne",
      role: "Secret role",
      archivedAt,
      deletedAt: null,
    },
  ];
  return data;
}
describe("identity-only archive recovery", () => {
  it("returns explicit identity keys and redacts direct and ancestor names for non-Owners", () => {
    const data = fixture();
    const editor = archiveRecovery(data, accountId, "editor");
    expect(editor.rows.map((row) => row.entity).sort()).toEqual(["activities", "clients", "projects", "resources"]);
    expect(JSON.stringify(editor)).not.toMatch(/Secret|codeName|archivedAt|deletedAt|avatar/);
    for (const row of editor.rows)
      expect(Object.keys(row).sort()).toEqual(
        (row.entity === "resources"
          ? ["archived", "entity", "group", "id", "label", "parent"]
          : ["archived", "entity", "id", "label", "parent"]
        ).sort(),
      );
    expect(editor.rows.find((row) => row.id === "activity")).toMatchObject({
      archived: false,
      parent: { entity: "projects", id: "project", label: '"Gotham"' },
    });
    expect(archiveRecovery(data, accountId, "admin")).toEqual(editor);
    expect(archiveRecovery(data, accountId, "owner").rows.find((row) => row.id === "client")?.label).toBe(
      "Secret client",
    );
  });
  it("omits any deleted ancestry even when an archived project masks its deleted client", () => {
    const data = fixture();
    requireFixture(data.clients[0]).deletedAt = archivedAt;
    expect(archiveRecovery(data, accountId, "owner").rows.map((row) => row.id)).toEqual(["person"]);
  });
  it("omits foreign rows, built-in clients and active visible rows; keeps independently archived children", () => {
    const data = fixture();
    data.clients.push({ ...requireFixture(data.clients[0]), id: "internal", builtin: true });
    data.resources.push({ ...requireFixture(data.resources[0]), id: "foreign", accountId: "a-loft" });
    data.resources.push({ ...requireFixture(data.resources[0]), id: "active", archivedAt: null });
    requireFixture(data.activities[0]).archivedAt = archivedAt;
    const rows = archiveRecovery(data, accountId, "editor").rows;
    expect(rows.map((row) => row.id).sort()).toEqual(["activity", "client", "person", "project"]);
    expect(rows.find((row) => row.id === "activity")?.archived).toBe(true);
    requireFixture(data.projects[0]).archivedAt = null;
    requireFixture(data.clients[0]).archivedAt = null;
    expect(archiveRecovery(data, accountId, "editor").rows.find((row) => row.id === "activity")?.parent).toBeNull();
  });
  it("uses safe malformed private labels and deterministic name/id order", () => {
    const data = fixture();
    requireFixture(data.clients[0]).codeName = "";
    data.resources.push({ ...requireFixture(data.resources[0]), id: "aaa" });
    const rows = archiveRecovery(data, accountId, "editor").rows;
    expect(JSON.stringify(rows)).not.toContain("Secret");
    expect(rows.filter((row) => row.entity === "resources").map((row) => row.id)).toEqual(["aaa", "person"]);
  });
  it("classifies every resource group and uses the role label only for unnamed placeholders", () => {
    const data = fixture();
    const resource = requireFixture(data.resources[0]);
    data.resources = [
      { ...resource, id: "studio", kind: "person", engagement: "studio" },
      { ...resource, id: "supplementary", kind: "person", engagement: "supplementary" },
      { ...resource, id: "external", kind: "external" },
      { ...resource, id: "placeholder", kind: "placeholder", name: "", role: "Designer" },
    ];
    expect(
      archiveRecovery(data, accountId, "editor")
        .rows.filter((row) => row.entity === "resources")
        .map((row) => row.group)
        .sort(),
    ).toEqual(["external", "placeholders", "studio", "supplementary"]);
    expect(archiveRecovery(data, accountId, "editor").rows.find((row) => row.id === "placeholder")?.label).toBe(
      "Designer",
    );
  });
});
