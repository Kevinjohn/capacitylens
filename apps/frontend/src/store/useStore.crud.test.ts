import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Allocation, AppData, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { PRESET_COLORS } from "@capacitylens/shared/lib/color";
import type { DomainError } from "@capacitylens/shared/domain/errors";
import {
  DEFAULT_ACCOUNT_ID,
  makeAppData,
  makeResource,
  makeResourceDraft,
  requireValue,
  resetStoreWithAccount,
  WORKDAYS,
} from "@/test/fixtures";

const s = () => useStore.getState();

function expectRevisionAdvanced(before: { updatedAt: string }, after: { updatedAt: string }): void {
  expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
}

beforeEach(async () => {
  await resetStoreWithAccount();
  s().clearFilters();
});

const personDraft = makeResourceDraft({ name: "Person", role: "Dev", color: "#1" });

// Omit the shared draft's false default to cover resources without the optional favourite flag.
const unflaggedDraft = { ...personDraft };
delete unflaggedDraft.isFavourite;

function registerStoreCrudEntity1(): void {
  it("accounts: update", async () => {
    const account = requireValue(s().data.accounts[0], "account");
    await s().updateAccount(account.id, { name: "Renamed company" });
    expect(s().data.accounts[0]?.name).toBe("Renamed company");
    expectRevisionAdvanced(account, requireValue(s().data.accounts[0], "updated account"));
  });
}

function registerStoreCrudEntity2(): void {
  it("accounts: defaults, stores and validates company working days", async () => {
    const account = requireValue(s().data.accounts[0], "account");
    await s().updateAccount(account.id, { workingDays: [1, 3, 5] });
    expect(s().data.accounts[0]?.workingDays).toEqual([1, 3, 5]);

    await expect(s().updateAccount(account.id, { workingDays: [] })).rejects.toThrow(/at least one working day/i);
    expect(s().data.accounts[0]?.workingDays).toEqual([1, 3, 5]);

    await expect(s().updateAccount(account.id, { workingDays: [1, 9] as Resource["workingDays"] })).rejects.toThrow(
      /working day/i,
    );
    expect(s().data.accounts[0]?.workingDays).toEqual([1, 3, 5]);

    expect(() => s().addAccount({ name: "Empty-week company", color: "#2d75da", workingDays: [] })).toThrow(
      /at least one working day/i,
    );

    const sundayStart = s().addAccount({ name: "Sunday company", color: "#2d75da", weekStartsOn: 0 });
    expect(sundayStart?.workingDays).toEqual([0, 1, 2, 3, 4]);
    expect(sundayStart?.schedulingMode).toBe("days");
    expect(sundayStart?.inlineActivityCreateEnabled).toBe(false);
    expect(() =>
      s().addAccount({
        name: "Malformed company",
        color: "#2d75da",
        workingDays: [1, 9] as Resource["workingDays"],
      }),
    ).toThrow(/working day/i);

    await s().updateAccount(account.id, { workingDays: [2, 4] });
    await s().undoPlanning();
    expect(s().data.accounts.find((candidate) => candidate.id === account.id)?.workingDays).toEqual([1, 3, 5]);
    await s().redoPlanning();
    expect(s().data.accounts.find((candidate) => candidate.id === account.id)?.workingDays).toEqual([2, 4]);
  });
}

function registerStoreCrudEntity3(): void {
  it("disciplines: add / update / delete", async () => {
    const d = await requireCreated(s().addDiscipline({ name: "Design", color: "#1", sortOrder: 0 }));
    await s().updateDiscipline(d.id, { name: "Design 2" });
    expect(s().data.disciplines[0]?.name).toBe("Design 2");
    expectRevisionAdvanced(d, requireValue(s().data.disciplines[0], "updated discipline"));
    await s().deleteDiscipline(d.id);
    expect(s().data.disciplines).toHaveLength(0);
  });

  // Clients/projects/resources have no immediate hard-delete action, removal goes through the
  // Active → Archived → Soft-deleted → Purged lifecycle (see useStore.lifecycle.test.ts). These
  // cover the add/update half of their CRUD; the lifecycle suite covers their removal.
}

function registerStoreCrudEntity4(): void {
  it("clients: add / update", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    await s().updateClient(c.id, { name: "Ferris 2" });
    expect(s().data.clients[0]?.name).toBe("Ferris 2");
    expectRevisionAdvanced(c, requireValue(s().data.clients[0], "updated client"));
  });
}

function registerStoreCrudEntity5(): void {
  it("projects: add / update", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    await s().updateProject(p.id, { name: "P2" });
    expect(s().data.projects[0]?.name).toBe("P2");
    expectRevisionAdvanced(p, requireValue(s().data.projects[0], "updated project"));
  });
}

function registerStoreCrudEntity6(): void {
  it("rejects private clients and projects without a usable code name", async () => {
    await expect(requireCreated(s().addClient({ name: "Secret", color: "#1", isPrivate: true }))).rejects.toThrow(
      /private client requires a code name/i,
    );

    const client = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    await expect(
      requireCreated(
        s().addProject({
          name: "Secret project",
          clientId: client.id,
          color: "#2",
          isPrivate: true,
          codeName: '""',
        }),
      ),
    ).rejects.toThrow(/private project requires a code name/i);

    expect(s().data.clients).toHaveLength(1);
    expect(s().data.projects).toHaveLength(0);
  });
}

function registerStoreCrudEntity7(): void {
  it("phases: add / update / delete (activities survive)", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const ph = await requireCreated(s().addPhase({ name: "Discovery", projectId: p.id }));
    const t = await requireCreated(
      s().addActivity({
        name: "T",
        kind: "project",
        projectId: p.id,
        phaseId: ph.id,
      }),
    );
    await s().updatePhase(ph.id, { name: "Disco" });
    expect(s().data.phases[0]?.name).toBe("Disco");
    expectRevisionAdvanced(ph, requireValue(s().data.phases[0], "updated phase"));
    await s().deletePhase(ph.id);
    expect(s().data.phases).toHaveLength(0);
    expect(
      requireValue(
        s().data.activities.find((x) => x.id === t.id),
        "activity",
      ).phaseId,
    ).toBeNull();
  });
}

function registerStoreCrudEntity8(): void {
  it("activities: add / update / delete", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
    await s().updateActivity(t.id, { name: "T2" });
    expect(s().data.activities[0]?.name).toBe("T2");
    expectRevisionAdvanced(t, requireValue(s().data.activities[0], "updated activity"));
    await s().deleteActivity(t.id);
    expect(s().data.activities).toHaveLength(1);
    expect(s().data.activities[0]?.id).toBe(t.id);
    expect(typeof s().data.activities[0]?.archivedAt).toBe("string");
  });
}

function registerStoreCrudEntity9(): void {
  it("activities: a general (no-project) activity can be added without a projectId", async () => {
    const t = await requireCreated(s().addActivity({ name: "Admin", kind: "repeatable" }));
    expect(t.projectId).toBeNull();
    expect(requireValue(s().data.activities[0], "activity")).toHaveProperty("projectId", null);
    expect(s().data.activities[0]?.name).toBe("Admin");
  });
}

function registerStoreCrudEntity10(): void {
  it("activities: a project-specific activity converts to all-projects by clearing its project + kind together", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
    await s().updateActivity(t.id, { kind: "repeatable", projectId: null });
    expect(s().data.activities[0]?.kind).toBe("repeatable");
    expect(requireValue(s().data.activities[0], "activity")).toHaveProperty("projectId", null);
  });
}

function registerStoreCrudEntity11(): void {
  it("activities: kind ⇆ projectId coherence is enforced — clearing a project activity’s project alone throws", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));

    await expect(s().updateActivity(t.id, { projectId: null })).rejects.toThrow(
      /project-specific activity must be assigned/i,
    );

    await expect(requireCreated(s().addActivity({ name: "X", kind: "internal", projectId: p.id }))).rejects.toThrow(
      /cannot belong to a project/i,
    );
  });
}

function registerStoreCrudEntity12(): void {
  it("activities: moving out of repeatable atomically clears allocation attribution", async () => {
    const resource = await requireCreated(s().addResource({ ...personDraft }));
    const client = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const project = await requireCreated(s().addProject({ name: "P", clientId: client.id, color: "#2" }));
    const activity = await requireCreated(s().addActivity({ name: "Shared", kind: "repeatable" }));
    const allocation = requireCreated(
      await s().addAllocation({
        resourceId: resource.id,
        activityId: activity.id,
        projectId: project.id,
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );

    await s().updateActivity(activity.id, { kind: "internal" });
    expect(s().data.activities.find((row) => row.id === activity.id)?.kind).toBe("internal");
    const cleared = requireValue(
      s().data.allocations.find((row) => row.id === allocation.id),
      "cleared allocation",
    );
    expect(cleared).toHaveProperty("projectId", null);
    expectRevisionAdvanced(allocation, cleared);
  });
}

function registerStoreCrudEntity13(): void {
  it("updateActivity validates the MERGED row, not the raw patch (partial phase/project patches)", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p1 = await requireCreated(s().addProject({ name: "P1", clientId: c.id, color: "#2" }));
    const p2 = await requireCreated(s().addProject({ name: "P2", clientId: c.id, color: "#3" }));
    const ph1 = await requireCreated(s().addPhase({ name: "Disco", projectId: p1.id }));
    const t = await requireCreated(
      s().addActivity({
        name: "T",
        kind: "project",
        projectId: p1.id,
        phaseId: ph1.id,
      }),
    );

    await expect(s().updateActivity(t.id, { phaseId: ph1.id })).resolves.toBeUndefined();

    await expect(s().updateActivity(t.id, { projectId: p2.id })).rejects.toThrow(/phase/i);
    expect(s().data.activities[0]?.projectId).toBe(p1.id);
  });
}

function registerStoreCrudEntity14(): void {
  it("resources: add / update", async () => {
    const r = await requireCreated(s().addResource({ ...personDraft }));
    await s().updateResource(r.id, { role: "Lead" });
    expect(s().data.resources[0]?.role).toBe("Lead");
    expectRevisionAdvanced(r, requireValue(s().data.resources[0], "updated resource"));
  });
}

function registerStoreCrudEntity15(): void {
  it("resources: defaults legacy people and placeholders to Studio engagement", async () => {
    const legacyPersonDraft = { ...personDraft };
    delete legacyPersonDraft.engagement;
    const person = await requireCreated(s().addResource(legacyPersonDraft));
    expect(person.engagement).toBe("studio");

    const client = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const project = await requireCreated(s().addProject({ name: "Project", clientId: client.id, color: "#2" }));
    await expect(
      s().addResource({
        ...personDraft,
        kind: "placeholder",
        projectId: project.id,
        engagement: "supplementary",
      }),
    ).rejects.toThrow(/placeholder must use Studio engagement/i);
    expect(s().data.resources.filter((resource) => resource.kind === "placeholder")).toHaveLength(0);
    const placeholder = await requireCreated(
      s().addResource({
        ...personDraft,
        kind: "placeholder",
        projectId: project.id,
      }),
    );
    expect(placeholder.engagement).toBe("studio");

    await expect(s().updateResource(placeholder.id, { engagement: "supplementary" })).rejects.toThrow(
      /placeholder must use Studio engagement/i,
    );
    expect(s().data.resources.find((resource) => resource.id === placeholder.id)?.engagement).toBe("studio");

    const personToPlaceholder = await requireCreated(
      s().addResource({
        ...personDraft,
        engagement: "supplementary",
        firstAvailableDate: "2026-06-01",
        lastAvailableDate: "2026-06-30",
      }),
    );
    await expect(
      s().updateResource(personToPlaceholder.id, { kind: "placeholder", projectId: project.id }),
    ).rejects.toThrow(/kind cannot change/i);
    const converted = s().data.resources.find((resource) => resource.id === personToPlaceholder.id);
    expect(converted?.kind).toBe("person");
    expect(converted?.engagement).toBe("supplementary");
    expect(converted?.firstAvailableDate).toBe("2026-06-01");
    expect(converted?.lastAvailableDate).toBe("2026-06-30");
  });
}

function registerStoreCrudEntity16(): void {
  it("resources: favourite updates are account data and undoable", async () => {
    const resource = await requireCreated(s().addResource({ ...unflaggedDraft }));

    await s().updateResource(resource.id, { isFavourite: true });
    expect(s().data.resources[0]?.isFavourite).toBe(true);

    await s().undoPlanning();
    expect(requireValue(s().data.resources[0], "resource")).toHaveProperty("isFavourite", null);
  });
}

function registerStoreCrudEntity17(): void {
  it("resources: a viewer cannot change an account favourite", async () => {
    const resource = await requireCreated(s().addResource({ ...unflaggedDraft }));

    s().setActiveRole("viewer");
    await s().updateResource(resource.id, { isFavourite: true });

    expect(requireValue(s().data.resources[0], "resource")).toHaveProperty("isFavourite", null);
    expect(s().notice).toMatchObject({ tone: "error" });
  });
}

function registerStoreCrudEntity18(): void {
  it("allocations: add / update / delete", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
    const r = await requireCreated(s().addResource({ ...personDraft }));
    const a = requireCreated(
      await s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );
    expect(await s().updateAllocation(a.id, { hoursPerDay: 4, status: "tentative" })).toBe(true);
    expect(s().data.allocations[0]).toMatchObject({
      hoursPerDay: 4,
      status: "tentative",
    });
    expectRevisionAdvanced(a, requireValue(s().data.allocations[0], "updated allocation"));
    await s().deleteAllocation(a.id);
    expect(s().data.allocations).toHaveLength(0);
  });
}

function registerStoreCrudEntity19(): void {
  it("time off: add / update / delete", async () => {
    const r = await requireCreated(s().addResource({ ...personDraft }));
    const to = await requireCreated(
      s().addTimeOff({
        resourceId: r.id,
        startDate: "2026-06-10",
        endDate: "2026-06-11",
        type: "holiday",
      }),
    );
    await s().updateTimeOff(to.id, { type: "sick" });
    expect(s().data.timeOff[0]?.type).toBe("sick");
    expectRevisionAdvanced(to, requireValue(s().data.timeOff[0], "updated time off"));
    await s().deleteTimeOff(to.id);
    expect(s().data.timeOff).toHaveLength(0);
  });
}

function registerStoreCrudEntity20(): void {
  it("company closure: add / update / delete with range validation", async () => {
    await expect(
      requireCreated(s().addClosure({ name: "  ", startDate: "2026-12-24", endDate: "2026-12-25" })),
    ).rejects.toThrow(expect.objectContaining<Partial<DomainError>>({ code: "closure_name_required" }));
    const closure = await requireCreated(
      s().addClosure({ name: "Christmas shutdown", startDate: "2026-12-24", endDate: "2026-12-25" }),
    );
    await s().updateClosure(closure.id, { name: "Winter shutdown" });
    expect(s().data.closures[0]).toMatchObject({ name: "Winter shutdown" });
    await expect(s().updateClosure(closure.id, { endDate: "2026-12-23" })).rejects.toThrow(
      /end date cannot be before the start date/i,
    );
    await expect(s().updateClosure(closure.id, { name: "  " })).rejects.toThrow(
      expect.objectContaining<Partial<DomainError>>({ code: "closure_name_required" }),
    );
    await s().deleteClosure(closure.id);
    expect(s().data.closures).toHaveLength(0);
  });
}

describe("store CRUD covers every entity", () => {
  registerStoreCrudEntity1();
  registerStoreCrudEntity2();
  registerStoreCrudEntity3();
  registerStoreCrudEntity4();
  registerStoreCrudEntity5();
  registerStoreCrudEntity6();
  registerStoreCrudEntity7();
  registerStoreCrudEntity8();
  registerStoreCrudEntity9();
  registerStoreCrudEntity10();
  registerStoreCrudEntity11();
  registerStoreCrudEntity12();
  registerStoreCrudEntity13();
  registerStoreCrudEntity14();
  registerStoreCrudEntity15();
  registerStoreCrudEntity16();
  registerStoreCrudEntity17();
  registerStoreCrudEntity18();
  registerStoreCrudEntity19();
  registerStoreCrudEntity20();
});

describe("store UI + history extras", () => {
  it("selectAllocation, setOriginDate and goToToday", () => {
    s().selectAllocation("abc");
    expect(s().ui.selectedAllocationId).toBe("abc");
    s().setOriginDate("2026-01-01");
    expect(s().ui.originDate).toBe("2026-01-01");
    s().goToToday();
    expect(s().ui.originDate).not.toBe("2026-01-01");
  });

  it("undo/redo are no-ops on empty history", async () => {
    await expect(s().undoPlanning()).resolves.toBe(false);
    await expect(s().redoPlanning()).resolves.toBe(false);
    expect(s().data.clients).toHaveLength(0);
  });

  it("a new mutation clears the redo stack", async () => {
    await s().addClient({ name: "A", color: "#1" });
    await s().undoPlanning();
    expect(s().planning.history.future).toHaveLength(1);
    await s().addClient({ name: "B", color: "#2" });
    expect(s().planning.history.future).toHaveLength(0);
  });

  it("bounds typed history at 50 entries and drops the oldest entries", async () => {
    for (let index = 0; index < 60; index += 1) {
      await s().addClient({ name: `Client ${index}`, color: "#1" });
    }

    expect(s().planning.history.past).toHaveLength(50);
    for (let index = 0; index < 50; index += 1) await s().undoPlanning();
    expect(s().data.clients.filter((client) => client.archivedAt === null)).toHaveLength(10);
    expect(s().planning.history.past).toHaveLength(0);

    expect(await s().undoPlanning()).toBe(false);
    expect(s().data.clients.filter((client) => client.archivedAt === null)).toHaveLength(10);
  });

  it("informs a viewer when undo and redo are refused", async () => {
    await s().addClient({ name: "A", color: "#1" });
    await s().undoPlanning();
    const afterUndo = s().data;
    const futureAfterUndo = s().planning.history.future;

    s().setActiveRole("viewer");
    expect(await s().redoPlanning()).toBe(false);
    expect(s().data).toBe(afterUndo);
    expect(s().planning.history.future).toBe(futureAfterUndo);
    expect(s().notice).toMatchObject({ tone: "error" });

    s().setActiveRole("editor");
    await s().redoPlanning();
    const afterRedo = s().data;
    const pastAfterRedo = s().planning.history.past;
    s().setNotice(null);
    s().setActiveRole("viewer");
    expect(await s().undoPlanning()).toBe(false);
    expect(s().data).toBe(afterRedo);
    expect(s().planning.history.past).toBe(pastAfterRedo);
    expect(s().notice).toMatchObject({ tone: "error" });
  });
});

describe("allocation integrity at the store boundary", () => {
  it("updateAllocation enforces the placeholder binding", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p1 = await requireCreated(s().addProject({ name: "P1", clientId: c.id, color: "#2" }));
    const p2 = await requireCreated(s().addProject({ name: "P2", clientId: c.id, color: "#3" }));
    const t1 = await requireCreated(
      s().addActivity({
        name: "T1",
        kind: "project",
        projectId: p1.id,
      }),
    );
    const t2 = await requireCreated(
      s().addActivity({
        name: "T2",
        kind: "project",
        projectId: p2.id,
      }),
    );
    const ph = await requireCreated(
      s().addResource({
        kind: "placeholder",
        role: "Designer",
        employmentType: "permanent",
        engagement: "studio" as const,
        workingHoursPerDay: 8,
        workingDays: WORKDAYS,
        halfDays: [],
        color: "#1",
        projectId: p1.id,
      }),
    );
    const a = requireCreated(
      await s().addAllocation({
        resourceId: ph.id,
        activityId: t1.id,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );
    await expect(s().updateAllocation(a.id, { activityId: t2.id })).rejects.toThrow(/placeholder.*bound project/i);
    expect(
      requireValue(
        s().data.allocations.find((x) => x.id === a.id),
        "allocation",
      ).activityId,
    ).toBe(t1.id);
  });

  it("addAllocation rejects dangling resource/activity references", async () => {
    await expect(
      s().addAllocation({
        resourceId: "nope",
        activityId: "nope",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    ).rejects.toThrow(/allocation must reference an existing resource and activity/i);
    expect(s().data.allocations).toHaveLength(0);
  });
});

const seedAlloc = async () => {
  const c = await requireCreated(s().addClient({ name: "Ferris", color: "#111111" }));
  const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#222222" }));
  const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
  const r = await requireCreated(s().addResource({ ...personDraft }));
  return { r, t };
};

function registerDateRangeGuard1(): void {
  it("addAllocation rejects an empty or reversed date range", async () => {
    const { r, t } = await seedAlloc();
    await expect(
      s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "",
        endDate: "",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    ).rejects.toThrow(/start and end dates are required/i);
    await expect(
      s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-05",
        endDate: "2026-06-01",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    ).rejects.toThrow(/end date cannot be before the start date/i);
    expect(s().data.allocations).toHaveLength(0);
  });
}

function registerDateRangeGuard2(): void {
  it("clamps allocation hoursPerDay to a real working day (<= 24) on add and update", async () => {
    const { r, t } = await seedAlloc();
    const a = requireCreated(
      await s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        hoursPerDay: 200,
        status: "confirmed",
      }),
    );
    expect(a.hoursPerDay).toBe(24);
    await s().updateAllocation(a.id, { hoursPerDay: 99 });
    expect(s().data.allocations[0]?.hoursPerDay).toBe(24);
  });
}

function registerDateRangeGuard3(): void {
  it("updateAllocation allows a note/status-only patch (validates the effective range, not the patch)", async () => {
    const { r, t } = await seedAlloc();
    const a = requireCreated(
      await s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );
    await s().updateAllocation(a.id, { status: "tentative" });
    expect(s().data.allocations[0]?.status).toBe("tentative");

    await expect(s().updateAllocation(a.id, { endDate: "2026-05-01" })).rejects.toThrow(
      /end date cannot be before the start date/i,
    );
    expect(s().data.allocations[0]?.endDate).toBe("2026-06-03");
  });
}

function registerDateRangeGuard4(): void {
  it("addTimeOff rejects a dangling resource and a reversed range", async () => {
    const r = await requireCreated(s().addResource({ ...personDraft }));
    await expect(
      requireCreated(
        s().addTimeOff({
          resourceId: "nope",
          startDate: "2026-06-01",
          endDate: "2026-06-02",
          type: "holiday",
        }),
      ),
    ).rejects.toThrow(/time off must reference an existing resource/i);
    await expect(
      requireCreated(
        s().addTimeOff({
          resourceId: r.id,
          startDate: "2026-06-05",
          endDate: "2026-06-01",
          type: "holiday",
        }),
      ),
    ).rejects.toThrow(/end date cannot be before the start date/i);
    expect(s().data.timeOff).toHaveLength(0);
  });
}

function registerDateRangeGuard5(): void {
  it("addResource / updateResource reject an empty working-days set", async () => {
    await expect(requireCreated(s().addResource({ ...personDraft, workingDays: [] }))).rejects.toThrow(
      /at least one working day/i,
    );
    const r = await requireCreated(s().addResource({ ...personDraft }));
    await expect(s().updateResource(r.id, { workingDays: [] })).rejects.toThrow(/at least one working day/i);
    await expect(s().updateResource(r.id, { name: "Renamed" })).resolves.toBeUndefined();
  });
}

function registerDateRangeGuard6(): void {
  it("requires half days to be a unique subset of the working week", async () => {
    await expect(
      requireCreated(s().addResource({ ...personDraft, workingDays: [1, 2], halfDays: [3] })),
    ).rejects.toThrow(/half days must be.*contained/i);
    const resource = await requireCreated(s().addResource({ ...personDraft, workingDays: [1, 2], halfDays: [2] }));
    expect(resource.halfDays).toEqual([2]);
    await expect(s().updateResource(resource.id, { workingDays: [1] })).rejects.toThrow(
      /half days must be.*contained/i,
    );
    await expect(s().updateResource(resource.id, { halfDays: [2, 2] })).rejects.toThrow(/half days must be unique/i);
  });
}

function registerDateRangeGuard7(): void {
  it("defaults placeholder working patterns on add and rejects invalid add and update", async () => {
    const client = await requireCreated(s().addClient({ name: "Wayne Enterprises", color: "#737373" }));
    const project = await requireCreated(s().addProject({ name: "Watchtower", clientId: client.id, color: "#737373" }));
    await expect(
      s().addResource({
        ...personDraft,
        kind: "placeholder",
        projectId: project.id,
        workingDays: [],
        halfDays: [6],
      }),
    ).rejects.toThrow(/must match its default working pattern/i);
    expect(s().data.resources.filter((resource) => resource.kind === "placeholder")).toHaveLength(0);
    const resource = await requireCreated(
      s().addResource({
        ...personDraft,
        kind: "placeholder",
        projectId: project.id,
      }),
    );

    expect(resource).toMatchObject({ workingDays: [1, 2, 3, 4, 5], halfDays: [] });
    await expect(s().updateResource(resource.id, { workingDays: [0, 6], halfDays: [6] })).rejects.toThrow(
      /must match its default working pattern/i,
    );
    expect(s().data.resources.find((candidate) => candidate.id === resource.id)).toMatchObject({
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
    });
  });
}

function registerDateRangeGuard8(): void {
  it("clamps resource workingHoursPerDay to (0, 24] on add and update (0/junk → 8, >24 → 24)", async () => {
    // The store is the last line for the resource path too (the form caps it, but a non-form
    // or pre-blur-paste write must not persist NaN / 0 / >24h capacity). 0 is not legal for a
    // resource: no working day, so it falls back to 8 (distinct from an allocation, where 0 is fine).
    const over = await requireCreated(
      s().addResource({
        ...personDraft,
        workingHoursPerDay: 1000,
      }),
    );
    expect(over.workingHoursPerDay).toBe(24);
    const zero = await requireCreated(
      s().addResource({
        ...personDraft,
        workingHoursPerDay: 0,
      }),
    );
    expect(zero.workingHoursPerDay).toBe(8);
    await s().updateResource(over.id, { workingHoursPerDay: NaN });
    expect(
      requireValue(
        s().data.resources.find((r) => r.id === over.id),
        "resource",
      ).workingHoursPerDay,
    ).toBe(8);
  });
}

function registerDateRangeGuard9(): void {
  it("importData replaces the active account slice and is undoable via ⌘Z", async () => {
    await s().addClient({ name: "Keep", color: "#111111" });
    s().setFilters({
      clientId: "stale-client",
      search: "retained search",
      hideTentative: true,
      showUnmatched: true,
    });
    s().selectAllocation("stale-allocation");
    s().toggleGroup("discipline:stale-discipline");

    const incoming = {
      ...emptyAppData(),
      clients: [
        {
          ...NULLABLE_FIELDS.clients,
          id: "imp",
          accountId: "X",
          createdAt: "t",
          updatedAt: "t",
          name: "Imported",
          color: "#222222",
        },
      ],
    };
    s().importData(incoming);
    expect(
      s()
        .data.clients.filter((c) => !c.builtin)
        .map((c) => c.name),
    ).toEqual(["Imported"]);
    expect(s().data.clients.filter((c) => c.builtin)).toHaveLength(1);
    expect(s().ui.selectedAllocationId).toBeNull();
    expect(s().ui.collapsedGroups).toEqual([]);
    expect(s().ui.filters).toMatchObject({
      disciplineId: null,
      clientId: null,
      projectId: null,
      activityId: null,
      activityKind: null,
      search: "retained search",
      hideTentative: true,
      showUnmatched: true,
    });
    s().undo();
    expect(s().data.clients.map((c) => c.name)).toEqual(["Keep"]);
  });
}

function registerDateRangeGuard10(): void {
  it("importData refuses a zero-record import (no silent wipe)", async () => {
    await s().addClient({ name: "Keep", color: "#111111" });
    const summary = s().importData(emptyAppData());
    expect(summary.imported).toBe(0);
    expect(s().data.clients.map((c) => c.name)).toEqual(["Keep"]);
  });
}

describe("date-range + reference guards at the store boundary", () => {
  registerDateRangeGuard1();
  registerDateRangeGuard2();
  registerDateRangeGuard3();
  registerDateRangeGuard4();
  registerDateRangeGuard5();
  registerDateRangeGuard6();
  registerDateRangeGuard7();
  registerDateRangeGuard8();
  registerDateRangeGuard9();
  registerDateRangeGuard10();
});

// Validate the complete row on every update so persisted invalid external allocations and time-off
// cannot pass a partial edit locally and fail when synchronized with the server.
const TS = "2026-05-01T00:00:00.000Z";

const externalResource = (id: string): Resource =>
  makeResource({
    id,
    accountId: DEFAULT_ACCOUNT_ID,
    createdAt: TS,
    updatedAt: TS,
    kind: "external",
    name: "Outsource Co",
    role: "Overflow",
    color: "#333333",
  });

function registerMergedRow1(): void {
  it("a normal-resource note/date-only updateAllocation + updateTimeOff still succeed (no false reject)", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
    const r = await requireCreated(s().addResource({ ...personDraft }));
    const a = requireCreated(
      await s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );

    await s().updateAllocation(a.id, { note: "ping" });
    await s().updateAllocation(a.id, { startDate: "2026-06-02" });
    expect(s().data.allocations[0]?.note).toBe("ping");
    expect(s().data.allocations[0]?.startDate).toBe("2026-06-02");

    const to = await requireCreated(
      s().addTimeOff({
        resourceId: r.id,
        startDate: "2026-06-10",
        endDate: "2026-06-11",
        type: "holiday",
      }),
    );
    await expect(s().updateTimeOff(to.id, { type: "sick" })).resolves.toBeUndefined();
    await expect(s().updateTimeOff(to.id, { startDate: "2026-06-09" })).resolves.toBeUndefined();
    expect(s().data.timeOff[0]?.type).toBe("sick");
  });
}

function registerMergedRow2(): void {
  it("rejects a note-only updateAllocation on an external resource carrying allocated hours", async () => {
    const ext = externalResource("ext-1");
    const alloc: Allocation = {
      ...NULLABLE_FIELDS.allocations,
      id: "alloc-1",
      accountId: DEFAULT_ACCOUNT_ID,
      createdAt: TS,
      updatedAt: TS,
      resourceId: ext.id,
      activityId: "act-1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",

      hoursPerDay: 8,
      status: "confirmed",
    };
    const data: AppData = makeAppData({
      resources: [ext],
      activities: [
        {
          ...NULLABLE_FIELDS.activities,
          id: "act-1",
          accountId: DEFAULT_ACCOUNT_ID,
          createdAt: TS,
          updatedAt: TS,
          name: "Repeatable",
          kind: "repeatable",
        },
      ],
      allocations: [alloc],
    });
    s().replaceAll(data);
    s().setActiveAccount(DEFAULT_ACCOUNT_ID);

    await expect(s().updateAllocation(alloc.id, { note: "just a note" })).rejects.toThrow(
      /external.*can.t carry hours/i,
    );
    expect(requireValue(s().data.allocations[0], "allocation")).toHaveProperty("note", null);
  });
}

function registerMergedRow3(): void {
  it("rejects a date-only updateTimeOff on an external resource", async () => {
    const ext = externalResource("ext-2");
    const timeOff: TimeOff = {
      id: "to-1",
      accountId: DEFAULT_ACCOUNT_ID,
      createdAt: TS,
      updatedAt: TS,
      resourceId: ext.id,
      startDate: "2026-06-10",
      endDate: "2026-06-12",
      type: "holiday",
      note: null,
    };
    const data: AppData = makeAppData({ resources: [ext], timeOff: [timeOff] });
    s().replaceAll(data);
    s().setActiveAccount(DEFAULT_ACCOUNT_ID);

    await expect(s().updateTimeOff(timeOff.id, { startDate: "2026-06-11" })).rejects.toThrow(/external.*3rd-party/i);
    expect(s().data.timeOff[0]?.startDate).toBe("2026-06-10");
  });
}

function registerMergedRow4(): void {
  it("a name-only updateResource on an external resource that still carries a loaded allocation THROWS", async () => {
    const ext = externalResource("ext-3");
    const data: AppData = makeAppData({
      resources: [ext],
      activities: [
        {
          ...NULLABLE_FIELDS.activities,
          id: "act-3",
          accountId: DEFAULT_ACCOUNT_ID,
          createdAt: TS,
          updatedAt: TS,
          name: "Repeatable",
          kind: "repeatable",
        },
      ],
      allocations: [
        {
          ...NULLABLE_FIELDS.allocations,
          id: "alloc-3",
          accountId: DEFAULT_ACCOUNT_ID,
          createdAt: TS,
          updatedAt: TS,
          resourceId: ext.id,
          activityId: "act-3",
          startDate: "2026-06-01",
          endDate: "2026-06-03",
          hoursPerDay: 8,
          status: "confirmed",
        },
      ],
    });
    s().replaceAll(data);
    s().setActiveAccount(DEFAULT_ACCOUNT_ID);

    await expect(s().updateResource(ext.id, { name: "Outsource Co Ltd" })).rejects.toThrow(
      /work and time off before making it external/i,
    );
    expect(s().data.resources[0]?.name).toBe("Outsource Co");
  });
}

describe("update* re-validates the merged row so the store + server agree", () => {
  registerMergedRow1();
  registerMergedRow2();
  registerMergedRow3();
  registerMergedRow4();
});

const NON_PRESET = "#7cd9e4";
const NEAREST_PRESET = "#7adae3";

function registerColourSnap1(): void {
  it("addClient / addProject / addDiscipline / addResource snap a non-preset colour to its nearest preset", async () => {
    const client = await requireCreated(s().addClient({ name: "Ferris", color: NON_PRESET }));
    expect(client.color).toBe(NEAREST_PRESET);
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);

    const project = await requireCreated(
      s().addProject({
        name: "P",
        clientId: client.id,
        color: NON_PRESET,
      }),
    );
    expect(project.color).toBe(NEAREST_PRESET);

    const discipline = await requireCreated(
      s().addDiscipline({
        name: "Design",
        color: NON_PRESET,
        sortOrder: 0,
      }),
    );
    expect(discipline.color).toBe(NEAREST_PRESET);

    const resource = await requireCreated(
      s().addResource({
        ...personDraft,
        color: NON_PRESET,
      }),
    );
    expect(resource.color).toBe(NEAREST_PRESET);
  });
}

function registerColourSnap2(): void {
  it("updateClient / updateProject / updateDiscipline / updateResource / updateAccount snap a non-preset colour on patch", async () => {
    const client = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    await s().updateClient(client.id, { color: NON_PRESET });
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);

    const project = await requireCreated(
      s().addProject({
        name: "P",
        clientId: client.id,
        color: "#1",
      }),
    );
    await s().updateProject(project.id, { color: NON_PRESET });
    expect(s().data.projects.find((p) => p.id === project.id)?.color).toBe(NEAREST_PRESET);

    const discipline = await requireCreated(
      s().addDiscipline({
        name: "Design",
        color: "#1",
        sortOrder: 0,
      }),
    );
    await s().updateDiscipline(discipline.id, { color: NON_PRESET });
    expect(s().data.disciplines.find((d) => d.id === discipline.id)?.color).toBe(NEAREST_PRESET);

    const resource = await requireCreated(
      s().addResource({
        ...personDraft,
      }),
    );
    await s().updateResource(resource.id, { color: NON_PRESET });
    expect(s().data.resources.find((r) => r.id === resource.id)?.color).toBe(NEAREST_PRESET);

    await s().updateAccount(DEFAULT_ACCOUNT_ID, { color: NON_PRESET });
    expect(s().data.accounts.find((a) => a.id === DEFAULT_ACCOUNT_ID)?.color).toBe(NEAREST_PRESET);
  });
}

function registerColourSnap3(): void {
  it("an external resource keeps NEUTRAL_COLOR (the one deliberate non-preset exception) instead of snapping", async () => {
    const NEUTRAL_COLOR = "#9ca3af";
    const ext = await requireCreated(
      s().addResource({
        ...personDraft,
        kind: "external",
        color: NEUTRAL_COLOR,
      }),
    );
    expect(ext.color).toBe(NEUTRAL_COLOR);
  });
}

function registerColourSnap4(): void {
  // Canonical spelling keeps client equality checks aligned with server-normalized colors.
  it("a preset colour with stray whitespace/casing is stored normalized, not verbatim", async () => {
    const RAW = "  #E02727  ";
    const NORMALIZED = "#e02727";
    const client = await requireCreated(s().addClient({ name: "Ferris", color: RAW }));
    expect(client.color).toBe(NORMALIZED);
    const stored = s().data.clients.find((c) => c.id === client.id)?.color;
    expect(stored).toBe(NORMALIZED);

    expect(PRESET_COLORS).toContain(stored);
  });
}

function registerColourSnap5(): void {
  it("a colourless patch leaves the stored colour untouched", async () => {
    const client = await requireCreated(s().addClient({ name: "Ferris", color: NON_PRESET }));
    await s().updateClient(client.id, { name: "Ferris 2" });
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);
  });
}

function registerColourSnap6(): void {
  it("a REJECTED add (viewer no-op) does NOT snap the colour and does NOT persist — the rejection surfaces via notice, not a silent repair", async () => {
    s().setActiveRole("viewer");
    const returned = await s().addClient({ name: "Ferris", color: NON_PRESET });
    expect(s().data.clients).toHaveLength(0);
    expect(s().notice).toMatchObject({ tone: "error" });
    expect(returned).toEqual({ kind: "blocked" });
  });
}

function registerColourSnap7(): void {
  it("a REJECTED update (viewer no-op) does not touch the stored colour", async () => {
    const client = await requireCreated(s().addClient({ name: "Ferris", color: NON_PRESET }));
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);
    s().setActiveRole("viewer");
    await s().updateClient(client.id, { color: "#123456" });
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);
    expect(s().notice).toMatchObject({ tone: "error" });
  });
}

describe("colour snapping: shared helper, nearest-preset (not fixed fallback), never silent on reject", () => {
  registerColourSnap1();
  registerColourSnap2();
  registerColourSnap3();
  registerColourSnap4();
  registerColourSnap5();
  registerColourSnap6();
  registerColourSnap7();
});
