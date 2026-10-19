import { NULLABLE_FIELDS } from "../types/nullableFields.js";
import { describe, it, expect } from "vitest";
import {
  activeOnly,
  archiveImpact,
  inspectLifecycleAncestry,
  lifecycleStatus,
} from "@capacitylens/shared/domain/lifecycle";
import type {
  LifecycleAncestryLookup,
  LifecycleAncestryRow,
  LifecycleFields,
} from "@capacitylens/shared/domain/lifecycle";
import { emptyAppData } from "../types/entities.js";
import type { AppData, Weekday } from "../types/entities.js";

const T_ARCH = "2026-01-01T00:00:00.000Z";
const T_DEL = "2026-02-01T00:00:00.000Z";

const ACTIVE_ONLY_ACCOUNT = "acct-1";

const makeActiveOnlyResource = (id: string, name: string, tombstones: LifecycleFields = {}) => ({
  ...NULLABLE_FIELDS.resources,
  id,
  accountId: ACTIVE_ONLY_ACCOUNT,
  kind: "person" as const,
  name,
  role: "Designer",
  employmentType: "permanent" as const,
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5] as Weekday[],
  halfDays: [],
  color: "#3b82f6",
  createdAt: T_ARCH,
  updatedAt: T_ARCH,
  ...tombstones,
});
const makeActiveOnlyClient = (id: string, name: string, tombstones: LifecycleFields = {}) => ({
  ...NULLABLE_FIELDS.clients,
  id,
  accountId: ACTIVE_ONLY_ACCOUNT,
  name,
  color: "#3b82f6",
  createdAt: T_ARCH,
  updatedAt: T_ARCH,
  ...tombstones,
});
const makeActiveOnlyProject = ({
  id,
  name,
  clientId,
  tombstones = {},
}: {
  id: string;
  name: string;
  clientId: string;
  tombstones?: LifecycleFields;
}) => ({
  ...NULLABLE_FIELDS.projects,
  id,
  accountId: ACTIVE_ONLY_ACCOUNT,
  name,
  clientId,
  color: "#3b82f6",
  createdAt: T_ARCH,
  updatedAt: T_ARCH,
  ...tombstones,
});
const ACTIVE_ONLY_DATA: AppData = {
  ...emptyAppData(),
  accounts: [
    {
      ...NULLABLE_FIELDS.accounts,
      id: ACTIVE_ONLY_ACCOUNT,
      name: "Studio",
      color: "#3b82f6",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  disciplines: [
    {
      ...NULLABLE_FIELDS.disciplines,
      id: "d1",
      accountId: ACTIVE_ONLY_ACCOUNT,
      name: "Design",
      sortOrder: 0,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  resources: [
    makeActiveOnlyResource("r-active", "Active"),
    makeActiveOnlyResource("r-archived", "Archived", { ...NULLABLE_FIELDS.resources, archivedAt: T_ARCH }),
    makeActiveOnlyResource("r-deleted", "Deleted", {
      ...NULLABLE_FIELDS.resources,
      archivedAt: T_ARCH,
      deletedAt: T_DEL,
    }),
  ],
  clients: [
    makeActiveOnlyClient("c-active", "Active Co"),
    makeActiveOnlyClient("c-archived", "Archived Co", { ...NULLABLE_FIELDS.clients, archivedAt: T_ARCH }),
    makeActiveOnlyClient("c-deleted", "Deleted Co", { ...NULLABLE_FIELDS.clients, deletedAt: T_DEL }),
  ],
  projects: [
    makeActiveOnlyProject({ ...NULLABLE_FIELDS.projects, id: "p-active", name: "Active P", clientId: "c-active" }),
    makeActiveOnlyProject({
      ...NULLABLE_FIELDS.projects,
      id: "p-hidden-parent",
      name: "Hidden with client",
      clientId: "c-archived",
    }),
    makeActiveOnlyProject({
      ...NULLABLE_FIELDS.projects,
      id: "p-archived",
      name: "Archived P",
      clientId: "c-active",
      tombstones: { archivedAt: T_ARCH },
    }),
    makeActiveOnlyProject({
      ...NULLABLE_FIELDS.projects,
      id: "p-deleted",
      name: "Deleted P",
      clientId: "c-active",
      tombstones: { deletedAt: T_DEL },
    }),
  ],
  phases: [
    {
      id: "ph1",
      accountId: ACTIVE_ONLY_ACCOUNT,
      name: "Build",
      projectId: "p-active",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      id: "ph-hidden",
      accountId: ACTIVE_ONLY_ACCOUNT,
      name: "Hidden",
      projectId: "p-hidden-parent",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  activities: [
    {
      ...NULLABLE_FIELDS.activities,
      id: "act1",
      accountId: ACTIVE_ONLY_ACCOUNT,
      name: "Activity",
      kind: "project" as const,
      projectId: "p-active",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      ...NULLABLE_FIELDS.activities,
      id: "act-hidden",
      accountId: ACTIVE_ONLY_ACCOUNT,
      name: "Hidden Activity",
      kind: "project" as const,
      projectId: "p-hidden-parent",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  allocations: [
    {
      ...NULLABLE_FIELDS.allocations,
      id: "al1",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-active",
      activityId: "act1",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      ...NULLABLE_FIELDS.allocations,
      id: "al-hidden-activity",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-active",
      activityId: "act-hidden",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      ...NULLABLE_FIELDS.allocations,
      id: "al-hidden-resource",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-archived",
      activityId: "act1",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  timeOff: [
    {
      note: null,
      id: "to1",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-active",
      startDate: "2026-02-01",
      endDate: "2026-02-03",
      type: "holiday" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      note: null,
      id: "to-hidden",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-archived",
      startDate: "2026-02-01",
      endDate: "2026-02-03",
      type: "holiday" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
};
const makeActiveOnlyData = (): AppData => structuredClone(ACTIVE_ONLY_DATA);

const registerActiveOnlyTest1 = (): void => {
  it("DROPS archived AND soft-deleted resources/clients/projects; KEEPS the active ones", () => {
    const out = activeOnly(makeActiveOnlyData());
    expect(out.resources.map((r) => r.id)).toEqual(["r-active"]);
    expect(out.clients.map((c) => c.id)).toEqual(["c-active"]);
    expect(out.projects.map((p) => p.id)).toEqual(["p-active"]);
  });
};

const registerActiveOnlyTest2 = (): void => {
  it("closure-prunes descendants of hidden parents/resources while preserving top-level metadata", () => {
    const input = makeActiveOnlyData();
    const out = activeOnly(input);
    expect(out.phases.map((row) => row.id)).toEqual(["ph1"]);
    expect(out.activities.map((row) => row.id)).toEqual(["act1"]);
    expect(out.allocations.map((row) => row.id)).toEqual(["al1"]);
    expect(out.timeOff.map((row) => row.id)).toEqual(["to1"]);
    expect(out.disciplines).toBe(input.disciplines);
    expect(out.accounts).toBe(input.accounts);
    expect(lifecycleStatus(input.activities.find((row) => row.id === "act-hidden") ?? {})).toBe("active");
  });
};

const registerActiveOnlyTest3 = (): void => {
  it("retains active rows with unresolved parents instead of inventing hidden lifecycle state", () => {
    const input = {
      ...emptyAppData(),
      projects: [
        {
          ...NULLABLE_FIELDS.projects,
          id: "p-dangling",
          accountId: "a1",
          clientId: "missing-client",
          name: "Visible integrity damage",
          color: "#2d75da",
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        },
        {
          id: "p-missing-field",
          accountId: "a1",
          name: "Missing parent field",
          color: "#2d75da",
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        } as AppData["projects"][number],
      ],
    };

    const out = activeOnly(input);
    expect(out.projects.map(({ id }) => id)).toEqual(["p-dangling", "p-missing-field"]);
    expect(out.projects.every((project) => lifecycleStatus(project) === "active")).toBe(true);
  });
};

const registerActiveOnlyTest4 = (): void => {
  it("treats null optional activity parents as absent and retains their allocations", () => {
    const input = {
      ...emptyAppData(),
      activities: [
        {
          id: "activity-with-null-parents",
          accountId: "a1",
          name: "Internal activity",
          kind: "internal",
          projectId: null,
          phaseId: null,
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        } as unknown as AppData["activities"][number],
      ],
      allocations: [
        {
          ...NULLABLE_FIELDS.allocations,
          id: "allocation-1",
          accountId: "a1",
          resourceId: "missing-resource",
          activityId: "activity-with-null-parents",
          startDate: "2026-01-01",
          endDate: "2026-01-05",
          hoursPerDay: 8,
          status: "confirmed" as const,
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        },
      ],
    };

    const out = activeOnly(input);
    expect(out.activities.map(({ id }) => id)).toEqual(["activity-with-null-parents"]);
    expect(out.allocations.map(({ id }) => id)).toEqual(["allocation-1"]);
  });
};

const registerActiveOnlyTest5 = (): void => {
  it("hides a repeatable allocation attributed to an inactive project", () => {
    const input: AppData = {
      ...emptyAppData(),
      projects: [
        {
          ...NULLABLE_FIELDS.projects,
          id: "archived-project",
          accountId: "a1",
          clientId: "missing-client",
          name: "Archived",
          color: "#2d75da",
          archivedAt: T_ARCH,
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        },
      ],
      allocations: [
        {
          ...NULLABLE_FIELDS.allocations,
          id: "attributed",
          accountId: "a1",
          resourceId: "missing-resource",
          activityId: "missing-activity",
          projectId: "archived-project",
          startDate: "2026-01-01",
          endDate: "2026-01-01",
          hoursPerDay: 8,
          status: "confirmed",
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        },
      ],
    };

    expect(activeOnly(input).allocations).toEqual([]);
  });
};

const registerActiveOnlyTest6 = (): void => {
  it("identifies the exact inactive ancestor inherited through every projection edge", () => {
    const input = makeActiveOnlyData();
    const lookup: LifecycleAncestryLookup = (table, id) =>
      (input[table] as unknown as LifecycleAncestryRow[]).find((row) => row.id === id);
    const inspect = (table: Parameters<typeof inspectLifecycleAncestry>[0], id: string) => {
      const row = lookup(table, id);
      if (!row) throw new Error(`Missing lifecycle test row ${table}.${id}`);
      return inspectLifecycleAncestry(table, row, lookup);
    };
    for (const [table, id, ancestorTable, ancestorId] of [
      ["projects", "p-hidden-parent", "clients", "c-archived"],
      ["phases", "ph-hidden", "clients", "c-archived"],
      ["activities", "act-hidden", "clients", "c-archived"],
      ["allocations", "al-hidden-activity", "clients", "c-archived"],
      ["allocations", "al-hidden-resource", "resources", "r-archived"],
      ["timeOff", "to-hidden", "resources", "r-archived"],
    ] as const) {
      expect(inspect(table, id)).toEqual({
        kind: "hidden",
        inactiveAncestor: { table: ancestorTable, id: ancestorId, state: "archived" },
      });
    }
    expect(inspect("allocations", "al1")).toEqual({ kind: "visible" });
  });
};

const registerActiveOnlyTest7 = (): void => {
  it("does NOT mutate the input (deep-equal the original) and returns a NEW object", () => {
    const input = makeActiveOnlyData();
    const snapshot = structuredClone(input);
    const out = activeOnly(input);
    expect(input).toEqual(snapshot);
    expect(input.resources).toHaveLength(3);
    expect(input.clients).toHaveLength(3);
    expect(input.projects).toHaveLength(4);
    expect(out).not.toBe(input);
  });
};

const registerActiveOnlyTest8 = (): void => {
  it("an all-active dataset is preserved (every row kept, every table present)", () => {
    const input = makeActiveOnlyData();
    input.resources = input.resources.filter((r) => r.id === "r-active");
    input.clients = input.clients.filter((c) => c.id === "c-active");
    input.projects = input.projects.filter((p) => p.id === "p-active");
    const out = activeOnly(input);
    expect(out.resources).toHaveLength(1);
    expect(out.clients).toHaveLength(1);
    expect(out.projects).toHaveLength(1);
    expect(Object.keys(out).sort()).toEqual(Object.keys(emptyAppData()).sort());
  });
};

const registerActiveOnlyTest9 = (): void => {
  it("an empty dataset projects to an empty dataset (no throw)", () => {
    const out = activeOnly(emptyAppData());
    expect(out.resources).toEqual([]);
    expect(out.clients).toEqual([]);
    expect(out.projects).toEqual([]);
  });
};

describe("activeOnly — VIEW/read projection that drops non-active resources/clients/projects (pure, immutable)", () => {
  registerActiveOnlyTest1();
  registerActiveOnlyTest2();
  registerActiveOnlyTest3();
  registerActiveOnlyTest4();
  registerActiveOnlyTest5();
  registerActiveOnlyTest6();
  registerActiveOnlyTest7();
  registerActiveOnlyTest8();
  registerActiveOnlyTest9();
});

const ARCHIVE_IMPACT_ACCOUNT = "acct-1";

const ARCHIVE_IMPACT_DATA: AppData = {
  ...emptyAppData(),
  accounts: [
    {
      ...NULLABLE_FIELDS.accounts,
      id: ARCHIVE_IMPACT_ACCOUNT,
      name: "Studio",
      color: "#3b82f6",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  resources: [
    {
      ...NULLABLE_FIELDS.resources,
      id: "r1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      kind: "person",
      name: "R",
      role: "Dev",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5] as Weekday[],
      halfDays: [],
      color: "#3b82f6",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  clients: [
    {
      ...NULLABLE_FIELDS.clients,
      id: "c1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "C1",
      color: "#3b82f6",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      ...NULLABLE_FIELDS.clients,
      id: "c-empty",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "Empty",
      color: "#3b82f6",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  projects: [
    {
      ...NULLABLE_FIELDS.projects,
      id: "p1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "P1",
      clientId: "c1",
      color: "#3b82f6",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  phases: [
    {
      id: "ph1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "Discovery",
      projectId: "p1",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  activities: [
    {
      ...NULLABLE_FIELDS.activities,
      id: "a1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "A1",
      kind: "project",
      projectId: "p1",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      ...NULLABLE_FIELDS.activities,
      id: "internal",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "Admin",
      kind: "internal",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  allocations: [
    {
      ...NULLABLE_FIELDS.allocations,
      id: "al1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      resourceId: "r1",
      activityId: "a1",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      ...NULLABLE_FIELDS.allocations,
      id: "al-internal",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      resourceId: "r1",
      activityId: "internal",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  timeOff: [
    {
      note: null,
      id: "to1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      resourceId: "r1",
      startDate: "2026-02-01",
      endDate: "2026-02-03",
      type: "holiday",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
};
const makeArchiveImpactData = (): AppData => structuredClone(ARCHIVE_IMPACT_DATA);

describe("archiveImpact — Activity root", () => {
  it("counts allocations hidden by archiving an activity while leaving the activity count at zero", () => {
    const input = makeArchiveImpactData();
    expect(archiveImpact(input, "activities", "a1")).toEqual({
      projects: 0,
      phases: 0,
      activities: 0,
      allocations: 1,
      timeOff: 0,
    });
  });
});

describe("archiveImpact", () => {
  it("counts a client’s active descendants: its projects + their project-activities + allocations", () => {
    // al-internal stays (its activity is internal, not under c1); to1 is a resource descendant.
    expect(archiveImpact(makeArchiveImpactData(), "clients", "c1")).toEqual({
      projects: 1,
      phases: 1,
      activities: 1,
      allocations: 1,
      timeOff: 0,
    });
  });

  it("reports zero descendants for an empty client", () => {
    expect(archiveImpact(makeArchiveImpactData(), "clients", "c-empty")).toEqual({
      projects: 0,
      phases: 0,
      activities: 0,
      allocations: 0,
      timeOff: 0,
    });
  });

  it.each([
    ["archived", { archivedAt: T_ARCH }, "already_inactive"],
    ["deleted", { archivedAt: T_ARCH, deletedAt: T_DEL }, "already_inactive"],
    ["missing", null, "invalid_transition"],
  ] as const)("fails loudly when the impact target is %s", (_state, tombstones, code) => {
    const input = makeArchiveImpactData();
    if (tombstones) {
      input.clients = input.clients.map((client) => (client.id === "c1" ? { ...client, ...tombstones } : client));
    }
    const id = tombstones ? "c1" : "not-there";

    expect(() => archiveImpact(input, "clients", id)).toThrow(
      expect.objectContaining({ name: "LifecycleTransitionError", code }),
    );
  });

  it("for a project: activities + allocations, and NEVER a self project count", () => {
    expect(archiveImpact(makeArchiveImpactData(), "projects", "p1")).toEqual({
      projects: 0,
      phases: 1,
      activities: 1,
      allocations: 1,
      timeOff: 0,
    });
  });

  it("for a resource: all its allocations (incl. the internal-activity one) + its time off", () => {
    expect(archiveImpact(makeArchiveImpactData(), "resources", "r1")).toEqual({
      projects: 0,
      phases: 0,
      activities: 0,
      allocations: 2,
      timeOff: 1,
    });
  });

  it("does NOT mutate the input", () => {
    const input = makeArchiveImpactData();
    const snapshot = structuredClone(input);
    archiveImpact(input, "clients", "c1");
    expect(input).toEqual(snapshot);
  });
});
