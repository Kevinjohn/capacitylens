import { expect } from "vitest";
import { emptyAppData } from "../types/entities";
import type { AppData, Resource } from "../types/entities";

export const CASCADE_REVISION = "2026-07-15T00:00:00.000Z";

export const placeholder = (over: Partial<Resource> = {}): Resource => ({
  id: "ph1",
  accountId: "acct-test",
  createdAt: "t",
  updatedAt: "t",
  kind: "placeholder",
  role: "Senior Designer",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: "#000",
  projectId: "p1",
  ...over,
  halfDays: over.halfDays ?? [],
});

export const unboundPlaceholder = (): Resource => {
  const resource = placeholder();
  delete resource.projectId;
  return resource;
};

export const person = (over: Partial<Resource> = {}): Resource => {
  const base = placeholder(over);
  delete base.projectId;
  return { ...base, kind: "person", ...over };
};

export function assertEntityById<T extends { id: string }>(entities: readonly T[], id: string): T {
  const entity = entities.find((candidate) => candidate.id === id);
  expect(entity, `Expected entity ${id}`).toBeDefined();
  if (entity === undefined) throw new Error(`Expected entity ${id}`);
  return entity;
}

export function sampleActivityData(): Pick<AppData, "activities" | "resources"> {
  return {
    activities: [
      {
        id: "t1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "Wires",
        kind: "project",
        projectId: "p1",
        phaseId: "phase1",
      },
      {
        id: "t2",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "Visual",
        kind: "project",
        projectId: "p1",
      },
    ],
    resources: [
      person({ id: "r1", disciplineId: "d1" }),
      placeholder({ id: "ph1", projectId: "p1", disciplineId: "d1" }),
    ],
  };
}

export function sampleCapacityData(): Pick<AppData, "allocations" | "timeOff"> {
  return {
    allocations: [
      {
        id: "a1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "r1",
        activityId: "t1",
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        hoursPerDay: 8,
        status: "confirmed",
      },
      {
        id: "a2",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "ph1",
        activityId: "t2",
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
}

// A small connected dataset: client c1 -> project p1 -> phase ph -> activities; allocations; a bound placeholder.
export function sampleData(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [
      {
        id: "d1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "Design",
        sortOrder: 0,
      },
    ],
    clients: [
      {
        id: "c1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "Ferris",
        color: "#111",
      },
    ],
    projects: [
      {
        id: "p1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "Lightning",
        clientId: "c1",
        color: "#222",
      },
    ],
    phases: [
      {
        id: "phase1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "Discovery",
        projectId: "p1",
      },
    ],
    ...sampleActivityData(),
    ...sampleCapacityData(),
  };
}

export function danglingPhaseData(): AppData {
  return {
    ...emptyAppData(),
    clients: [
      {
        id: "c1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "C",
        color: "#1",
      },
    ],
    projects: [
      {
        id: "p1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "P1",
        clientId: "c1",
        color: "#1",
      },
      {
        id: "p2",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "P2",
        clientId: "c1",
        color: "#2",
      },
    ],
    phases: [
      {
        id: "ph-p1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "Ph",
        projectId: "p1",
      },
    ],
    activities: [
      {
        id: "t-keep",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "Keep",
        kind: "project",
        projectId: "p2",
        phaseId: "ph-p1",
      },
    ],
  };
}

export function siblingProjectData(): AppData {
  return {
    ...danglingPhaseData(),
    phases: [
      {
        id: "ph-p1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "Ph1",
        projectId: "p1",
      },
      {
        id: "ph-p2",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "Ph2",
        projectId: "p2",
      },
    ],
    activities: [
      {
        id: "a-p1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "A1",
        kind: "project",
        projectId: "p1",
        phaseId: "ph-p1",
      },
      {
        id: "a-p2",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "A2",
        kind: "project",
        projectId: "p2",
        phaseId: "ph-p2",
      },
    ],
    allocations: [
      {
        id: "al-p2",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "ph2",
        activityId: "a-p2",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
      },
    ],
    resources: [placeholder({ id: "ph2", projectId: "p2" })],
  };
}

export function siblingClientHierarchy(): Pick<AppData, "clients" | "projects" | "phases"> {
  return {
    clients: [
      {
        id: "c1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "C1",
        color: "#1",
      },
      {
        id: "c2",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "C2",
        color: "#2",
      },
    ],
    projects: [
      {
        id: "p1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "P1",
        clientId: "c1",
        color: "#1",
      },
      {
        id: "p2",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "P2",
        clientId: "c2",
        color: "#2",
      },
    ],
    phases: [
      {
        id: "ph1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "Ph1",
        projectId: "p1",
      },
      {
        id: "ph2",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "Ph2",
        projectId: "p2",
      },
    ],
  };
}

export function siblingClientActivityData(): Pick<AppData, "activities"> {
  return {
    activities: [
      {
        id: "a1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "A1",
        kind: "project",
        projectId: "p1",
      },
      {
        id: "a2",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "A2",
        kind: "project",
        projectId: "p2",
        phaseId: "ph2",
      },
      {
        id: "a3",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "A3",
        kind: "project",
        projectId: "p2",
        phaseId: "ph1",
      },
    ],
  };
}

export function siblingClientCapacityData(): Pick<AppData, "allocations" | "resources"> {
  return {
    allocations: [
      {
        id: "al1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "phc2",
        activityId: "a1",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
      },
      {
        id: "al2",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "phc2",
        activityId: "a2",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
      },
    ],
    resources: [placeholder({ id: "phc1", projectId: "p1" }), placeholder({ id: "phc2", projectId: "p2" })],
  };
}

export function siblingClientData(): AppData {
  return {
    ...emptyAppData(),
    ...siblingClientHierarchy(),
    ...siblingClientActivityData(),
    ...siblingClientCapacityData(),
  };
}
