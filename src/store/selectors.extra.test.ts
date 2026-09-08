import { describe, it, expect } from "vitest";
import {
  listResourceAllocations,
  byDisciplineOrder,
  clientById,
  projectById,
  resourceById,
  activityById,
} from "./selectors";
import type { Discipline } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { DEFAULT_ACCOUNT_ID, makeResource } from "../test/fixtures";

const data: AppData = {
  ...emptyAppData(),
  clients: [{ id: "c1", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "Acme", color: "#1" }],
  projects: [
    { id: "p1", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "P1", clientId: "c1", color: "#2" },
    { id: "p2", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "P2", clientId: "c1", color: "#3" },
  ],
  phases: [{ id: "ph1", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "Disc", projectId: "p1" }],
  activities: [
    { id: "t1", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "T1", kind: "project", projectId: "p1" },
  ],
  resources: [makeResource({ id: "r1", accountId: DEFAULT_ACCOUNT_ID, name: "A", role: "Dev", color: "#4" })],
  allocations: [
    {
      id: "a1",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    },
  ],
  timeOff: [
    {
      id: "to1",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      type: "holiday",
    },
  ],
};

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to exist`);
  }
  return value;
}

describe("lookup + relation selectors", () => {
  it("by-id selectors find entities (and return undefined for misses)", () => {
    const client = requireValue(clientById(data, "c1"), "client c1");
    const project = requireValue(projectById(data, "p1"), "project p1");
    const activity = requireValue(activityById(data, "t1"), "activity t1");
    const resource = requireValue(resourceById(data, "r1"), "resource r1");

    expect(client.name).toBe("Acme");
    expect(project.name).toBe("P1");
    expect(activity.name).toBe("T1");
    expect(resource.name).toBe("A");
    expect(clientById(data, "nope")).toBeUndefined();
  });

  it("relation selectors filter children", () => {
    expect(listResourceAllocations(data, "r1").map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("byDisciplineOrder (scheduler grouping)", () => {
  const disc = (id: string, name: string, sortOrder: number): Discipline => ({
    id,
    accountId: "acct-test",
    name,
    sortOrder,
    createdAt: "t",
    updatedAt: "t",
  });

  it("orders by sortOrder, then name as a stable tiebreak on equal sortOrder", () => {
    const list = [disc("a", "Zeta", 1), disc("b", "Alpha", 1), disc("c", "Beta", 0)];
    expect([...list].sort(byDisciplineOrder).map((d) => d.name)).toEqual(["Beta", "Alpha", "Zeta"]);
  });
});
