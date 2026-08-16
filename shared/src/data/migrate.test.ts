import { describe, it, expect } from "vitest";
import { InvalidSchemaVersionError, migrate, UnsupportedSchemaVersionError } from "./migrate";
import { emptyAppData, EXPORT_SCHEMA_VERSION } from "../types/entities";
import { sanitizeImportedRecord } from "../lib/sanitizeImport";

describe("migrate", () => {
  it("returns empty data for null/garbage", () => {
    expect(migrate(null)).toEqual(emptyAppData());
    expect(migrate("nope")).toEqual(emptyAppData());
    expect(migrate(42)).toEqual(emptyAppData());
    expect(migrate(undefined)).toEqual(emptyAppData());
  });

  it("unwraps a { schemaVersion, data } wrapper", () => {
    const data = {
      ...emptyAppData(),
      clients: [{ id: "c1", createdAt: "t", updatedAt: "t", name: "A", color: "#1" }],
    };
    expect(migrate({ schemaVersion: 1, data })).toEqual(data);
  });

  it("refuses a forward schema instead of normalizing and later overwriting it", () => {
    expect(() =>
      migrate({
        schemaVersion: EXPORT_SCHEMA_VERSION + 1,
        data: { ...emptyAppData(), futureTable: [{ id: "future" }] },
      }),
    ).toThrow(UnsupportedSchemaVersionError);
  });

  it.each([
    ["string", "9"],
    ["null", null],
    ["undefined", undefined],
    ["fractional", 1.5],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("refuses a present %s schema version instead of treating it as legacy", (_label, schemaVersion) => {
    expect(() =>
      migrate({
        schemaVersion,
        data: { resources: [{ id: "r1", isFreelancer: true }] },
      }),
    ).toThrow(InvalidSchemaVersionError);
  });

  it("accepts a bare AppData (legacy, no wrapper)", () => {
    const data = {
      ...emptyAppData(),
      resources: [
        {
          id: "r1",
          createdAt: "t",
          updatedAt: "t",
          kind: "person",
          role: "Dev",
          employmentType: "permanent",
          engagement: "studio" as const,
          workingHoursPerDay: 8,
          workingDays: [1, 2, 3, 4, 5],
          color: "#1",
        },
      ],
    };
    expect(migrate(data)).toEqual({ ...data, resources: [{ ...data.resources[0], halfDays: [] }] });
  });

  it("migrates legacy isFreelancer resources to employmentType (v1 → v2)", () => {
    const legacy = {
      schemaVersion: 1,
      data: {
        resources: [
          {
            id: "r1",
            createdAt: "t",
            updatedAt: "t",
            kind: "person",
            role: "Dev",
            workingHoursPerDay: 8,
            workingDays: [1, 2, 3, 4, 5],
            color: "#1",
            isFreelancer: true,
          },
        ],
      },
    };
    const out = migrate(legacy);
    expect(out.resources[0]).toMatchObject({ employmentType: "freelancer" });
    expect("isFreelancer" in out.resources[0]).toBe(false);
  });

  it("treats a missing version as legacy and still migrates", () => {
    const out = migrate({
      resources: [
        {
          id: "r1",
          createdAt: "t",
          updatedAt: "t",
          kind: "person",
          role: "Dev",
          workingHoursPerDay: 8,
          workingDays: [1],
          color: "#1",
          isFreelancer: false,
        },
      ],
    });
    expect(out.resources[0]).toMatchObject({ employmentType: "permanent" });
  });

  it("retains a versionless wrapper as supported legacy data", () => {
    const out = migrate({
      data: {
        resources: [
          {
            id: "r1",
            createdAt: "t",
            updatedAt: "t",
            kind: "person",
            role: "Dev",
            workingHoursPerDay: 8,
            workingDays: [1],
            color: "#1",
            isFreelancer: true,
          },
        ],
      },
    });
    expect(out.resources[0]).toMatchObject({ employmentType: "freelancer" });
  });

  it("retains v2 fields while applying later required-field migrations", () => {
    const data = {
      ...emptyAppData(),
      resources: [
        {
          id: "r1",
          createdAt: "t",
          updatedAt: "t",
          kind: "person",
          role: "Dev",
          employmentType: "contractor",
          engagement: "studio" as const,
          workingHoursPerDay: 8,
          workingDays: [1],
          color: "#1",
        },
      ],
    };
    expect(migrate({ schemaVersion: 2, data })).toEqual({
      ...data,
      resources: [{ ...data.resources[0], halfDays: [] }],
    });
  });

  it("leaves a v7 account without internalColourMode absent so it reads as grey", () => {
    const data = {
      ...emptyAppData(),
      accounts: [
        {
          id: "a1",
          createdAt: "t",
          updatedAt: "t",
          name: "Studio",
          color: "#2d75da",
        },
      ],
    };
    const out = migrate({ schemaVersion: 7, data });
    expect(out.accounts[0].internalColourMode).toBeUndefined();
  });

  it("keeps schema-v6 clients and projects without privacy fields public", () => {
    const out = migrate({
      schemaVersion: 6,
      data: {
        ...emptyAppData(),
        clients: [
          {
            id: "c1",
            accountId: "a1",
            createdAt: "t",
            updatedAt: "t",
            name: "Public client",
            color: "#2d75da",
          },
        ],
        projects: [
          {
            id: "p1",
            accountId: "a1",
            createdAt: "t",
            updatedAt: "t",
            name: "Public project",
            clientId: "c1",
            color: "#2d75da",
          },
        ],
      },
    });

    const client = sanitizeImportedRecord("clients", { ...out.clients[0] });
    const project = sanitizeImportedRecord("projects", { ...out.projects[0] });
    expect(client).toMatchObject({ name: "Public client" });
    expect(project).toMatchObject({ name: "Public project" });
    for (const row of [client, project]) {
      expect(row).not.toHaveProperty("isPrivate");
      expect(row).not.toHaveProperty("codeName");
    }
  });

  it("leaves a v8 account without the schedule view prefs absent so they read as shown/enabled (v8 → v9)", () => {
    // v8→v9 is a metadata-only step (like v7→v8): the three new optional booleans stay ABSENT so the
    // client's `?? true` reads them as shown/enabled — the migration materialises no defaults.
    const data = {
      ...emptyAppData(),
      accounts: [
        {
          id: "a1",
          createdAt: "t",
          updatedAt: "t",
          name: "Studio",
          color: "#2d75da",
        },
      ],
    };
    const out = migrate({ schemaVersion: 8, data });
    expect(out.accounts[0].showInternalProjects).toBeUndefined();
    expect(out.accounts[0].showInternalActivities).toBeUndefined();
    expect(out.accounts[0].inlineActivityCreateEnabled).toBeUndefined();
  });

  it("preserves explicit false schedule view prefs across migration (v8 → v9)", () => {
    const data = {
      ...emptyAppData(),
      accounts: [
        {
          id: "a1",
          createdAt: "t",
          updatedAt: "t",
          name: "Studio",
          color: "#2d75da",
          showInternalProjects: false,
          showInternalActivities: false,
          inlineActivityCreateEnabled: false,
        },
      ],
    };
    const out = migrate({ schemaVersion: 8, data });
    expect(out.accounts[0].showInternalProjects).toBe(false);
    expect(out.accounts[0].showInternalActivities).toBe(false);
    expect(out.accounts[0].inlineActivityCreateEnabled).toBe(false);
  });

  it("leaves legacy resources not favourite unless the optional flag is present (v9 → v10)", () => {
    const data = {
      ...emptyAppData(),
      resources: [
        {
          id: "r1",
          accountId: "a1",
          createdAt: "t",
          updatedAt: "t",
          kind: "person" as const,
          name: "Bruce Wayne",
          role: "Director",
          employmentType: "permanent" as const,
          workingHoursPerDay: 8,
          workingDays: [1, 2, 3, 4, 5] as const,
          color: "#2d75da",
        },
      ],
    };

    const out = migrate({ schemaVersion: 9, data });
    expect(out.resources[0].isFavourite).toBeUndefined();
    expect(out.resources[0].engagement).toBe("studio");
  });

  it("migrates v10 resources to an empty half-day subset without changing custom full-day capacity", () => {
    const resource = {
      id: "r1",
      accountId: "a1",
      createdAt: "t",
      updatedAt: "t",
      kind: "person" as const,
      name: "Barbara Gordon",
      role: "Engineer",
      employmentType: "permanent" as const,
      workingHoursPerDay: 6,
      workingDays: [1, 3, 5] as const,
      color: "#2d75da",
    };

    const out = migrate({ schemaVersion: 10, data: { ...emptyAppData(), resources: [resource] } });
    expect(out.resources[0]).toEqual({ ...resource, halfDays: [], engagement: "studio" });
  });

  it("migrates v11 resources to Studio engagement", () => {
    const resource = {
      id: "r1",
      accountId: "a1",
      createdAt: "t",
      updatedAt: "t",
      kind: "person" as const,
      name: "Barbara Gordon",
      role: "Engineer",
      employmentType: "contractor" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5] as const,
      halfDays: [3] as const,
      color: "#2d75da",
    };

    const out = migrate({ schemaVersion: 11, data: { ...emptyAppData(), resources: [resource] } });
    expect(out.resources[0]).toEqual({ ...resource, engagement: "studio" });
  });

  it("preserves current engagement and half-day values in a bare server slice", () => {
    const resource = {
      id: "r1",
      accountId: "a1",
      createdAt: "t",
      updatedAt: "t",
      kind: "person" as const,
      name: "Barbara Gordon",
      role: "Engineer",
      employmentType: "contractor" as const,
      engagement: "supplementary" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5] as const,
      halfDays: [2] as const,
      color: "#2d75da",
    };

    const out = migrate({ ...emptyAppData(), resources: [resource] });
    expect(out.resources[0]).toEqual(resource);
  });

  it("leaves v12 engagement grouping absent so the default-on selector applies", () => {
    const account = {
      id: "a1",
      createdAt: "t",
      updatedAt: "t",
      name: "Studio",
      color: "#2d75da",
    };

    const out = migrate({ schemaVersion: 12, data: { ...emptyAppData(), accounts: [account] } });
    expect(out.accounts[0]).toEqual({ ...account, workingDays: [1, 2, 3, 4, 5] });
    expect(out.accounts[0].groupResourcesByEngagement).toBeUndefined();
  });

  it("backfills activity kind on a pre-v4 payload (v3 → v4): project-bound → project, project-less → repeatable", () => {
    // Legacy input still carries the OLD `tasks` key (pre-rename); migrate renames it to
    // `activities` (v4→v5) so the OUTPUT is asserted on `out.activities`.
    const out = migrate({
      schemaVersion: 3,
      data: {
        tasks: [
          {
            id: "t1",
            accountId: "a1",
            createdAt: "t",
            updatedAt: "t",
            name: "Wires",
            projectId: "p1",
          },
          {
            id: "t2",
            accountId: "a1",
            createdAt: "t",
            updatedAt: "t",
            name: "Admin",
          },
        ],
      },
    });
    expect(out.activities[0]).toMatchObject({ id: "t1", kind: "project" });
    expect(out.activities[1]).toMatchObject({ id: "t2", kind: "repeatable" });
  });

  it("backfills kind in a versionless blob that already uses the activities key", () => {
    const out = migrate({
      activities: [
        { id: "a1", name: "Project work", projectId: "p1" },
        { id: "a2", name: "General work" },
      ],
    });

    expect(out.activities).toEqual([
      expect.objectContaining({ id: "a1", kind: "project" }),
      expect.objectContaining({ id: "a2", kind: "repeatable" }),
    ]);
  });

  it("preserves an already-set activity kind when backfilling (the v3→v4 guard is idempotent)", () => {
    const out = migrate({
      schemaVersion: 3,
      data: {
        tasks: [
          {
            id: "t1",
            accountId: "a1",
            createdAt: "t",
            updatedAt: "t",
            name: "Admin",
            kind: "internal",
          },
        ],
      },
    });
    expect(out.activities[0]).toMatchObject({ kind: "internal" });
  });

  it("uses a collision-free id when v5 synthesis meets an ordinary internal-shaped id", () => {
    const out = migrate({
      schemaVersion: 5,
      data: {
        ...emptyAppData(),
        accounts: [{ id: "a1", name: "Studio", color: "#2d75da", createdAt: "t", updatedAt: "t" }],
        clients: [
          {
            id: "internal:a1",
            accountId: "a1",
            name: "Ordinary",
            color: "#2d75da",
            createdAt: "t",
            updatedAt: "t",
          },
        ],
      },
    });
    expect(out.clients.map((client) => client.id)).toEqual(["internal:a1", "internal:a1:1"]);
    expect(out.clients[1]).toMatchObject({ accountId: "a1", builtin: true });
  });

  it("backfills account working days from week start at v13 to v14", () => {
    const out = migrate({
      schemaVersion: 13,
      data: {
        ...emptyAppData(),
        accounts: [
          { id: "sun", name: "Sunday", color: "#2d75da", weekStartsOn: 0, createdAt: "t", updatedAt: "t" },
          { id: "mon", name: "Monday", color: "#2d75da", weekStartsOn: 1, createdAt: "t", updatedAt: "t" },
          {
            id: "sun-empty",
            name: "Empty Sunday",
            color: "#2d75da",
            weekStartsOn: 0,
            workingDays: [],
            createdAt: "t",
            updatedAt: "t",
          },
          {
            id: "mon-empty",
            name: "Empty Monday",
            color: "#2d75da",
            weekStartsOn: 1,
            workingDays: [],
            createdAt: "t",
            updatedAt: "t",
          },
        ],
      },
    });

    expect(out.accounts.find((account) => account.id === "sun")?.workingDays).toEqual([0, 1, 2, 3, 4]);
    expect(out.accounts.find((account) => account.id === "mon")?.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(out.accounts.find((account) => account.id === "sun-empty")?.workingDays).toEqual([0, 1, 2, 3, 4]);
    expect(out.accounts.find((account) => account.id === "mon-empty")?.workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps legacy repeat allocations unlinked at v14 to v15", () => {
    const legacy = {
      id: "a1",
      accountId: "account",
      resourceId: "resource",
      activityId: "activity",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      hoursPerDay: 8,
      status: "confirmed" as const,
      createdAt: "t",
      updatedAt: "t",
    };
    const out = migrate({ schemaVersion: 14, data: { ...emptyAppData(), allocations: [legacy] } });

    expect(out.allocations).toEqual([legacy]);
    expect(out.allocations[0]).not.toHaveProperty("seriesId");
  });

  it("keeps existing personal time off unchanged at v15 to v16", () => {
    const legacy = {
      id: "to1",
      accountId: "account",
      resourceId: "resource",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      type: "holiday" as const,
      createdAt: "t",
      updatedAt: "t",
    };
    const out = migrate({ schemaVersion: 15, data: { ...emptyAppData(), timeOff: [legacy] } });

    expect(out.timeOff).toEqual([legacy]);
  });

  it("renames the legacy `tasks` table → `activities` and `taskId` → `activityId` (v4 → v5)", () => {
    const out = migrate({
      schemaVersion: 4,
      data: {
        tasks: [
          {
            id: "t1",
            accountId: "a1",
            createdAt: "t",
            updatedAt: "t",
            name: "Wires",
            kind: "project",
            projectId: "p1",
          },
        ],
        allocations: [
          {
            id: "al1",
            accountId: "a1",
            createdAt: "t",
            updatedAt: "t",
            resourceId: "r1",
            taskId: "t1",
            startDate: "2026-01-01",
            endDate: "2026-01-02",
            hoursPerDay: 8,
            status: "confirmed",
          },
        ],
      },
    });
    // The renamed table arrives as `activities`; the old key is gone.
    expect(out.activities).toHaveLength(1);
    expect(out.activities[0]).toMatchObject({ id: "t1", kind: "project" });
    expect("tasks" in out).toBe(false);
    // The allocation's FK is renamed; no `taskId` survives.
    expect(out.allocations[0]).toMatchObject({ activityId: "t1" });
    expect("taskId" in out.allocations[0]).toBe(false);
  });

  it("merges a mixed v4 rename state without losing legacy-only work or modern conflicts", () => {
    const out = migrate({
      schemaVersion: 4,
      data: {
        tasks: [
          {
            id: "legacy-only",
            accountId: "a1",
            createdAt: "t",
            updatedAt: "t",
            name: "Legacy",
            kind: "repeatable",
          },
          {
            id: "shared",
            accountId: "a1",
            createdAt: "old",
            updatedAt: "old",
            name: "Legacy conflict",
            kind: "repeatable",
          },
        ],
        activities: [
          {
            id: "shared",
            accountId: "a1",
            createdAt: "new",
            updatedAt: "new",
            name: "Modern conflict",
            kind: "internal",
          },
          {
            id: "modern-only",
            accountId: "a1",
            createdAt: "t",
            updatedAt: "t",
            name: "Modern",
            kind: "repeatable",
          },
        ],
        allocations: [
          { id: "legacy-allocation", taskId: "legacy-only" },
          {
            id: "mixed-allocation",
            taskId: "legacy-only",
            activityId: "modern-only",
          },
        ],
      },
    });

    expect(out.activities.map(({ id }) => id)).toEqual(["shared", "modern-only", "legacy-only"]);
    expect(out.activities.find(({ id }) => id === "shared")).toMatchObject({
      name: "Modern conflict",
      kind: "internal",
    });
    expect(out.allocations[0]).toMatchObject({ activityId: "legacy-only" });
    expect(out.allocations[1]).toMatchObject({ activityId: "modern-only" });
    expect(out.allocations.every((allocation) => !("taskId" in allocation))).toBe(true);
  });

  it("treats a bare (versionless) legacy `tasks` blob as pre-v5 and renames it", () => {
    const out = migrate({
      tasks: [
        {
          id: "t1",
          accountId: "a1",
          createdAt: "t",
          updatedAt: "t",
          name: "Admin",
          kind: "internal",
        },
      ],
    });
    expect(out.activities).toHaveLength(1);
    expect("tasks" in out).toBe(false);
  });

  it("fills in any missing arrays so the shape is always complete", () => {
    const out = migrate({
      schemaVersion: 1,
      data: {
        clients: [{ id: "c1", createdAt: "t", updatedAt: "t", name: "A", color: "#1" }],
      },
    });
    expect(out).toMatchObject({
      disciplines: [],
      resources: [],
      projects: [],
      phases: [],
      activities: [],
      allocations: [],
      timeOff: [],
    });
    expect(out.clients).toHaveLength(1);
  });
});
