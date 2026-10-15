import { expect } from "vitest";
import { NULLABLE_FIELDS } from "../types/nullableFields.js";
import { emptyAppData } from "../types/entities.js";
import type { AppData, Resource } from "../types/entities.js";

export const placeholder = (over: Partial<Resource> = {}): Resource => ({
  ...NULLABLE_FIELDS.resources,
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
  resource.projectId = null;
  return resource;
};

export const person = (over: Partial<Resource> = {}): Resource => {
  const base = placeholder(over);
  base.projectId = null;
  return { ...base, kind: "person", ...over };
};

export function assertEntityById<T extends { id: string }>(entities: readonly T[], id: string): T {
  const entity = entities.find((candidate) => candidate.id === id);
  expect(entity, `Expected entity ${id}`).toBeDefined();
  if (entity === undefined) throw new Error(`Expected entity ${id}`);
  return entity;
}

function sampleActivityData(): Pick<AppData, "activities" | "resources"> {
  return {
    activities: [
      {
        ...NULLABLE_FIELDS.activities,
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
        ...NULLABLE_FIELDS.activities,
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

function sampleCapacityData(): Pick<AppData, "allocations" | "timeOff"> {
  return {
    allocations: [
      {
        ...NULLABLE_FIELDS.allocations,
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
        ...NULLABLE_FIELDS.allocations,
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
        note: null,
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
        ...NULLABLE_FIELDS.disciplines,
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
        ...NULLABLE_FIELDS.clients,
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
        ...NULLABLE_FIELDS.projects,
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
      { ...NULLABLE_FIELDS.clients, id: "c1", accountId: "a", createdAt: "t", updatedAt: "t", name: "C", color: "#1" },
    ],
    projects: [
      {
        ...NULLABLE_FIELDS.projects,
        id: "p1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "P1",
        clientId: "c1",
        color: "#1",
      },
      {
        ...NULLABLE_FIELDS.projects,
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
        ...NULLABLE_FIELDS.activities,
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

function siblingProjectHierarchy(): Pick<AppData, "phases" | "activities"> {
  return {
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
        ...NULLABLE_FIELDS.activities,
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
        ...NULLABLE_FIELDS.activities,
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
  };
}

export function siblingProjectData(): AppData {
  return {
    ...danglingPhaseData(),
    ...siblingProjectHierarchy(),
    allocations: [
      {
        ...NULLABLE_FIELDS.allocations,
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

function siblingClientHierarchy(): Pick<AppData, "clients" | "projects" | "phases"> {
  return {
    clients: [
      { ...NULLABLE_FIELDS.clients, id: "c1", accountId: "a", createdAt: "t", updatedAt: "t", name: "C1", color: "#1" },
      { ...NULLABLE_FIELDS.clients, id: "c2", accountId: "a", createdAt: "t", updatedAt: "t", name: "C2", color: "#2" },
    ],
    projects: [
      {
        ...NULLABLE_FIELDS.projects,
        id: "p1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "P1",
        clientId: "c1",
        color: "#1",
      },
      {
        ...NULLABLE_FIELDS.projects,
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

function siblingClientActivityData(): Pick<AppData, "activities"> {
  return {
    activities: [
      {
        ...NULLABLE_FIELDS.activities,
        id: "a1",
        accountId: "a",
        createdAt: "t",
        updatedAt: "t",
        name: "A1",
        kind: "project",
        projectId: "p1",
      },
      {
        ...NULLABLE_FIELDS.activities,
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
        ...NULLABLE_FIELDS.activities,
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

function siblingClientCapacityData(): Pick<AppData, "allocations" | "resources"> {
  return {
    allocations: [
      {
        ...NULLABLE_FIELDS.allocations,
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
        ...NULLABLE_FIELDS.allocations,
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
