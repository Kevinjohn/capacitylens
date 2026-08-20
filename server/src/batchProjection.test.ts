import { describe, expect, it, vi } from "vitest";
import {
  deleteActivityCascade,
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
} from "@capacitylens/shared/lib/integrity";
import { deleteAccountCascade } from "@capacitylens/shared/domain/mutations";
import { APP_DATA_KEYS, emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { BatchStateProjection } from "./batchProjection";
import { validateWrite } from "./validate";

const TS = "2026-01-01T00:00:00.000Z";
const meta = { createdAt: TS, updatedAt: TS };

function relationshipFixture(): AppData {
  return {
    accounts: [{ id: "a1", name: "Studio", color: "#5c34d4", ...meta }],
    clients: [{ id: "c1", accountId: "a1", name: "Client", color: "#5c34d4", ...meta }],
    disciplines: [{ id: "d1", accountId: "a1", name: "Design", sortOrder: 0, ...meta }],
    projects: [
      {
        id: "p1",
        accountId: "a1",
        clientId: "c1",
        name: "Project",
        color: "#5c34d4",
        ...meta,
      },
    ],
    phases: [{ id: "ph1", accountId: "a1", projectId: "p1", name: "Phase", ...meta }],
    resources: [
      {
        id: "r1",
        accountId: "a1",
        kind: "placeholder",
        role: "Designer",
        employmentType: "permanent",
        engagement: "studio" as const,
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        projectId: "p1",
        disciplineId: "d1",
        color: "#5c34d4",
        ...meta,
      },
    ],
    activities: [
      {
        id: "act1",
        accountId: "a1",
        name: "Activity",
        kind: "project",
        projectId: "p1",
        phaseId: "ph1",
        ...meta,
      },
      {
        id: "act2",
        accountId: "a1",
        name: "Shared activity",
        kind: "repeatable",
        ...meta,
      },
    ],
    allocations: [
      {
        id: "al1",
        accountId: "a1",
        resourceId: "r1",
        activityId: "act1",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        hoursPerDay: 8,
        status: "confirmed",
        ...meta,
      },
      {
        id: "al2",
        accountId: "a1",
        resourceId: "r1",
        activityId: "act2",
        projectId: "p1",
        startDate: "2026-01-03",
        endDate: "2026-01-04",
        hoursPerDay: 8,
        status: "confirmed",
        ...meta,
      },
    ],
    timeOff: [
      {
        id: "to1",
        accountId: "a1",
        resourceId: "r1",
        startDate: "2026-01-03",
        endDate: "2026-01-04",
        type: "holiday",
        ...meta,
      },
    ],
    closures: [],
  };
}

const canonical = (data: AppData): AppData =>
  Object.fromEntries(
    APP_DATA_KEYS.map((table) => [table, [...data[table]].sort((left, right) => left.id.localeCompare(right.id))]),
  ) as unknown as AppData;

describe("BatchStateProjection", () => {
  it.each([
    ["accounts", "a1", (data: AppData) => deleteAccountCascade(data, "a1")],
    ["clients", "c1", (data: AppData) => deleteClientCascade(data, "c1", TS)],
    ["disciplines", "d1", (data: AppData) => deleteDisciplineCascade(data, "d1", TS)],
    ["projects", "p1", (data: AppData) => deleteProjectCascade(data, "p1", TS)],
    ["phases", "ph1", (data: AppData) => deletePhaseCascade(data, "ph1", TS)],
    ["resources", "r1", (data: AppData) => deleteResourceCascade(data, "r1")],
    ["activities", "act1", (data: AppData) => deleteActivityCascade(data, "act1")],
  ] as const)("mirrors %s cascade and SET NULL behavior", (table, id, expected) => {
    const initial = relationshipFixture();
    const projection = new BatchStateProjection(structuredClone(initial));

    projection.delete(table, id);

    expect(canonical(projection.data)).toEqual(canonical(expected(initial)));
  });

  it("updates and deletes the supported 5,000-row boundary without per-op array rebuilding", () => {
    const data = emptyAppData();
    data.allocations = Array.from({ length: 5_000 }, (_, index) => ({
      id: `allocation-${index}`,
      accountId: "a1",
      resourceId: "r1",
      activityId: "act1",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      hoursPerDay: 8,
      status: "confirmed" as const,
      ...meta,
    }));
    const projection = new BatchStateProjection(data);
    const rows = projection.data.allocations;
    const findIndex = vi.spyOn(rows, "findIndex").mockImplementation(() => {
      throw new Error("projection performed a linear findIndex");
    });
    const map = vi.spyOn(rows, "map").mockImplementation(() => {
      throw new Error("projection rebuilt the full array with map");
    });
    const filter = vi.spyOn(rows, "filter").mockImplementation(() => {
      throw new Error("projection rebuilt the full array with filter");
    });

    for (let index = 0; index < 5_000; index += 1) {
      projection.upsert("allocations", { ...rows[index], hoursPerDay: 7 });
    }
    for (let index = 0; index < 5_000; index += 1) {
      projection.delete("allocations", `allocation-${index}`);
    }

    expect(rows).toHaveLength(0);
    expect(findIndex).not.toHaveBeenCalled();
    expect(map).not.toHaveBeenCalled();
    expect(filter).not.toHaveBeenCalled();
  });

  it("validates 5,000 client updates through indexes without rescanning the tenant table", () => {
    const data = emptyAppData();
    data.clients = Array.from({ length: 5_000 }, (_, index) => ({
      id: `client-${index}`,
      accountId: "a1",
      name: `Client ${index}`,
      color: "#5c34d4",
      ...meta,
    }));
    const projection = new BatchStateProjection(data);
    const find = vi.spyOn(data.clients, "find").mockImplementation(() => {
      throw new Error("batch validation scanned the full clients table");
    });
    const some = vi.spyOn(data.clients, "some").mockImplementation(() => {
      throw new Error("batch validation scanned the full clients table");
    });

    for (let index = 0; index < 5_000; index += 1) {
      const id = `client-${index}`;
      const existing = projection.row("clients", id);
      expect(existing).toBeDefined();
      const updated = { ...existing!, name: `Updated ${index}` };
      validateWrite(projection.data, "clients", updated, existing, projection);
      projection.upsert("clients", updated);
    }

    expect(find).not.toHaveBeenCalled();
    expect(some).not.toHaveBeenCalled();
    expect(projection.row("clients", "client-4999")?.name).toBe("Updated 4999");
  });

  it("reparents projects before replacing the generated Internal client", () => {
    const data = relationshipFixture();
    data.clients[0] = { ...data.clients[0], id: "internal:a1", builtin: true };
    data.projects[0] = { ...data.projects[0], clientId: "internal:a1" };
    const projection = new BatchStateProjection(data);

    projection.replaceGeneratedBuiltin("internal:a1", {
      id: "imported-internal",
      accountId: "a1",
      name: "Internal",
      color: "#2d75da",
      builtin: true,
      ...meta,
    });

    expect(projection.data.clients.map((client) => client.id)).toEqual(["imported-internal"]);
    expect(projection.data.projects[0].clientId).toBe("imported-internal");
  });

  it("keeps reverse allocation lookups current across resource and activity edits", () => {
    const projection = new BatchStateProjection(relationshipFixture());

    expect(projection.allocationsForResource("a1", "r1").map((row) => row.id)).toEqual(["al1", "al2"]);
    expect(projection.allocationsForActivity("a1", "act1").map((row) => row.id)).toEqual(["al1"]);
    projection.upsert("allocations", {
      ...projection.data.allocations[0],
      resourceId: "r2",
      activityId: "act2",
    });
    expect(projection.allocationsForResource("a1", "r1").map((row) => row.id)).toEqual(["al2"]);
    expect(projection.allocationsForResource("a1", "r2").map((row) => row.id)).toEqual(["al1"]);
    expect(projection.allocationsForActivity("a1", "act1")).toEqual([]);
    expect(projection.allocationsForActivity("a1", "act2").map((row) => row.id)).toEqual(["al2", "al1"]);
  });

  it("mirrors allocation attribution revisions produced by the database sweep", () => {
    const projection = new BatchStateProjection(relationshipFixture());

    projection.upsert("activities", { ...projection.data.activities[1], kind: "project", projectId: "p1" });
    projection.clearAllocationAttribution([{ id: "al2", createdAt: TS, updatedAt: "2026-01-02T00:00:00.000Z" }]);

    expect(projection.row("allocations", "al2")).toMatchObject({
      id: "al2",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(projection.row("allocations", "al2")).not.toHaveProperty("projectId");
  });
});
