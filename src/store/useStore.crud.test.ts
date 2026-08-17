import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Allocation, AppData, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { PRESET_COLORS } from "@capacitylens/shared/lib/color";
import {
  DEFAULT_ACCOUNT_ID,
  makeAppData,
  makeResource,
  makeResourceDraft,
  resetStoreWithAccount,
  WORKDAYS,
} from "../test/fixtures";

const s = () => useStore.getState();

function expectRevisionAdvanced(before: { updatedAt: string }, after: { updatedAt: string }): void {
  expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
}

beforeEach(() => {
  resetStoreWithAccount();
  s().clearFilters();
});

const personDraft = makeResourceDraft({ name: "Person", role: "Dev", color: "#1" });

/** The shared draft seeds isFavourite: false; the two favourite specs pin the ABSENT flag, so they
 *  add a resource carrying no flag at all. */
const unflaggedDraft = { ...personDraft, isFavourite: undefined };

describe("store CRUD covers every entity", () => {
  it("accounts: update", () => {
    const account = s().data.accounts[0];
    s().updateAccount(account.id, { name: "Renamed company" });
    expect(s().data.accounts[0].name).toBe("Renamed company");
    expectRevisionAdvanced(account, s().data.accounts[0]);
  });

  it("accounts: defaults, stores and validates company working days", () => {
    const account = s().data.accounts[0];
    s().updateAccount(account.id, { workingDays: [1, 3, 5] });
    expect(s().data.accounts[0].workingDays).toEqual([1, 3, 5]);

    expect(() => s().updateAccount(account.id, { workingDays: [] })).toThrow(/at least one working day/i);
    expect(s().data.accounts[0].workingDays).toEqual([1, 3, 5]);

    expect(() => s().updateAccount(account.id, { workingDays: [1, 9] as Resource["workingDays"] })).toThrow(
      /working day/i,
    );
    expect(s().data.accounts[0].workingDays).toEqual([1, 3, 5]);

    expect(() => s().addAccount({ name: "Empty-week company", color: "#2d75da", workingDays: [] })).toThrow(
      /at least one working day/i,
    );

    const sundayStart = s().addAccount({ name: "Sunday company", color: "#2d75da", weekStartsOn: 0 });
    expect(sundayStart?.workingDays).toEqual([0, 1, 2, 3, 4]);
    expect(() =>
      s().addAccount({
        name: "Malformed company",
        color: "#2d75da",
        workingDays: [1, 9] as Resource["workingDays"],
      }),
    ).toThrow(/working day/i);

    s().updateAccount(account.id, { workingDays: [2, 4] });
    s().undo();
    expect(s().data.accounts[0].workingDays).toEqual([1, 3, 5]);
    s().redo();
    expect(s().data.accounts[0].workingDays).toEqual([2, 4]);
  });

  it("disciplines: add / update / delete", () => {
    const d = s().addDiscipline({ name: "Design", color: "#1", sortOrder: 0 });
    s().updateDiscipline(d.id, { name: "Design 2" });
    expect(s().data.disciplines[0].name).toBe("Design 2");
    expectRevisionAdvanced(d, s().data.disciplines[0]);
    s().deleteDiscipline(d.id);
    expect(s().data.disciplines).toHaveLength(0);
  });

  // Clients/projects/resources have NO immediate hard-delete action — removal goes through the
  // Active → Archived → Soft-deleted → Purged lifecycle (see useStore.lifecycle.test.ts). These
  // cover the add/update half of their CRUD; the lifecycle suite covers their removal.
  it("clients: add / update", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    s().updateClient(c.id, { name: "Acme 2" });
    expect(s().data.clients[0].name).toBe("Acme 2");
    expectRevisionAdvanced(c, s().data.clients[0]);
  });

  it("projects: add / update", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#2" });
    s().updateProject(p.id, { name: "P2" });
    expect(s().data.projects[0].name).toBe("P2");
    expectRevisionAdvanced(p, s().data.projects[0]);
  });

  it("rejects private clients and projects without a usable code name", () => {
    expect(() => s().addClient({ name: "Secret", color: "#1", isPrivate: true })).toThrow(
      /private client requires a code name/i,
    );

    const client = s().addClient({ name: "Acme", color: "#1" });
    expect(() =>
      s().addProject({
        name: "Secret project",
        clientId: client.id,
        color: "#2",
        isPrivate: true,
        codeName: '""',
      }),
    ).toThrow(/private project requires a code name/i);

    expect(s().data.clients).toHaveLength(1);
    expect(s().data.projects).toHaveLength(0);
  });

  it("phases: add / update / delete (activities survive)", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#2" });
    const ph = s().addPhase({ name: "Discovery", projectId: p.id });
    const t = s().addActivity({
      name: "T",
      kind: "project",
      projectId: p.id,
      phaseId: ph.id,
    });
    s().updatePhase(ph.id, { name: "Disco" });
    expect(s().data.phases[0].name).toBe("Disco");
    expectRevisionAdvanced(ph, s().data.phases[0]);
    s().deletePhase(ph.id);
    expect(s().data.phases).toHaveLength(0);
    expect(s().data.activities.find((x) => x.id === t.id)!.phaseId).toBeUndefined();
  });

  it("activities: add / update / delete", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p.id });
    s().updateActivity(t.id, { name: "T2" });
    expect(s().data.activities[0].name).toBe("T2");
    expectRevisionAdvanced(t, s().data.activities[0]);
    s().deleteActivity(t.id);
    expect(s().data.activities).toHaveLength(0);
  });

  it("activities: a general (no-project) activity can be added without a projectId", () => {
    const t = s().addActivity({ name: "Admin", kind: "repeatable" });
    expect(t.projectId).toBeUndefined();
    expect(s().data.activities[0].projectId).toBeUndefined();
    expect(s().data.activities[0].name).toBe("Admin");
  });

  it("activities: a project-specific activity converts to cross-project by clearing its project + kind together", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p.id });
    s().updateActivity(t.id, { kind: "repeatable", projectId: undefined });
    expect(s().data.activities[0].kind).toBe("repeatable");
    expect(s().data.activities[0].projectId).toBeUndefined();
  });

  it("activities: kind ⇆ projectId coherence is enforced — clearing a project activity’s project alone throws", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p.id });
    // Leaving kind='project' while removing the project is incoherent — rejected at the store boundary.
    expect(() => s().updateActivity(t.id, { projectId: undefined })).toThrow(
      /project-specific activity must be assigned/i,
    );
    // And an internal/cross-project activity may not carry a project.
    expect(() => s().addActivity({ name: "X", kind: "internal", projectId: p.id })).toThrow(
      /cannot belong to a project/i,
    );
  });

  it("updateActivity validates the MERGED row, not the raw patch (partial phase/project patches)", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p1 = s().addProject({ name: "P1", clientId: c.id, color: "#2" });
    const p2 = s().addProject({ name: "P2", clientId: c.id, color: "#3" });
    const ph1 = s().addPhase({ name: "Disco", projectId: p1.id }); // a phase OF p1
    const t = s().addActivity({
      name: "T",
      kind: "project",
      projectId: p1.id,
      phaseId: ph1.id,
    });

    // A phaseId-ONLY patch (re-setting the same phase) must NOT be wrongly rejected: the
    // merged row still carries projectId from the existing activity, so coherence holds.
    expect(() => s().updateActivity(t.id, { phaseId: ph1.id })).not.toThrow();

    // A projectId-ONLY patch that would leave a STALE cross-project phaseId IS rejected
    // (merged row: projectId=p2 but phaseId=ph1-of-p1) instead of silently persisting an
    // incoherent activity the server would later 400 on sync.
    expect(() => s().updateActivity(t.id, { projectId: p2.id })).toThrow(/phase/i);
    expect(s().data.activities[0].projectId).toBe(p1.id); // unchanged — the bad patch didn't land
  });

  it("resources: add / update", () => {
    const r = s().addResource({ ...personDraft });
    s().updateResource(r.id, { role: "Lead" });
    expect(s().data.resources[0].role).toBe("Lead");
    expectRevisionAdvanced(r, s().data.resources[0]);
  });

  it("resources: defaults legacy people and forces placeholders to Studio engagement", () => {
    const person = s().addResource({ ...personDraft, engagement: undefined });
    expect(person.engagement).toBe("studio");

    const client = s().addClient({ name: "Acme", color: "#1" });
    const project = s().addProject({ name: "Project", clientId: client.id, color: "#2" });
    const placeholder = s().addResource({
      ...personDraft,
      kind: "placeholder",
      projectId: project.id,
      engagement: "supplementary",
    });
    expect(placeholder.engagement).toBe("studio");

    s().updateResource(placeholder.id, { engagement: "supplementary" });
    expect(s().data.resources.find((resource) => resource.id === placeholder.id)?.engagement).toBe("studio");

    const personToPlaceholder = s().addResource({ ...personDraft, engagement: "supplementary" });
    s().updateResource(personToPlaceholder.id, { kind: "placeholder", projectId: project.id });
    expect(s().data.resources.find((resource) => resource.id === personToPlaceholder.id)?.engagement).toBe("studio");
  });

  it("resources: favourite updates are account data and undoable", () => {
    const resource = s().addResource({ ...unflaggedDraft });

    s().updateResource(resource.id, { isFavourite: true });
    expect(s().data.resources[0].isFavourite).toBe(true);

    s().undo();
    expect(s().data.resources[0].isFavourite).toBeUndefined();
  });

  it("resources: a viewer cannot change an account favourite", () => {
    const resource = s().addResource({ ...unflaggedDraft });

    s().setActiveRole("viewer");
    s().updateResource(resource.id, { isFavourite: true });

    expect(s().data.resources[0].isFavourite).toBeUndefined();
    expect(s().notice).toMatchObject({ tone: "error" });
  });

  it("allocations: add / update / delete", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p.id });
    const r = s().addResource({ ...personDraft });
    const a = s().addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    expect(s().updateAllocation(a.id, { hoursPerDay: 4, status: "tentative" })).toBe(true);
    expect(s().data.allocations[0]).toMatchObject({
      hoursPerDay: 4,
      status: "tentative",
    });
    expectRevisionAdvanced(a, s().data.allocations[0]);
    s().deleteAllocation(a.id);
    expect(s().data.allocations).toHaveLength(0);
  });

  it("time off: add / update / delete", () => {
    const r = s().addResource({ ...personDraft });
    const to = s().addTimeOff({
      resourceId: r.id,
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      type: "holiday",
    });
    s().updateTimeOff(to.id, { type: "sick" });
    expect(s().data.timeOff[0].type).toBe("sick");
    expectRevisionAdvanced(to, s().data.timeOff[0]);
    s().deleteTimeOff(to.id);
    expect(s().data.timeOff).toHaveLength(0);
  });

  it("company closure: add / update / delete with range validation", () => {
    const closure = s().addClosure({ name: "Christmas shutdown", startDate: "2026-12-24", endDate: "2026-12-25" });
    s().updateClosure(closure.id, { name: "Winter shutdown" });
    expect(s().data.closures[0]).toMatchObject({ name: "Winter shutdown" });
    expect(() => s().updateClosure(closure.id, { endDate: "2026-12-23" })).toThrow(
      /end date cannot be before the start date/i,
    );
    expect(() => s().updateClosure(closure.id, { name: "  " })).toThrow(/closure name is required/i);
    s().deleteClosure(closure.id);
    expect(s().data.closures).toHaveLength(0);
  });
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

  it("undo/redo are no-ops on empty history", () => {
    expect(() => s().undo()).not.toThrow();
    expect(() => s().redo()).not.toThrow();
    expect(s().data.clients).toHaveLength(0);
  });

  it("a new mutation clears the redo stack", () => {
    s().addClient({ name: "A", color: "#1" });
    s().undo();
    expect(s().future).toHaveLength(1);
    s().addClient({ name: "B", color: "#2" });
    expect(s().future).toHaveLength(0);
  });

  it("bounds full-state history at 50 entries and drops the oldest snapshots", () => {
    for (let index = 0; index < 60; index += 1) {
      s().addClient({ name: `Client ${index}`, color: "#1" });
    }

    expect(s().past).toHaveLength(50);
    for (let index = 0; index < 50; index += 1) s().undo();
    expect(s().data.clients).toHaveLength(10);
    expect(s().past).toHaveLength(0);

    s().undo();
    expect(s().data.clients).toHaveLength(10);
  });

  it("informs a viewer when undo and redo are refused", () => {
    s().addClient({ name: "A", color: "#1" });
    s().undo();
    const afterUndo = s().data;
    const futureAfterUndo = s().future;

    s().setActiveRole("viewer");
    s().redo();
    expect(s().data).toBe(afterUndo);
    expect(s().future).toBe(futureAfterUndo);
    expect(s().notice).toMatchObject({ tone: "error" });

    s().setActiveRole("editor");
    s().redo();
    const afterRedo = s().data;
    const pastAfterRedo = s().past;
    s().setNotice(null);
    s().setActiveRole("viewer");
    s().undo();
    expect(s().data).toBe(afterRedo);
    expect(s().past).toBe(pastAfterRedo);
    expect(s().notice).toMatchObject({ tone: "error" });
  });
});

describe("allocation integrity at the store boundary", () => {
  it("updateAllocation enforces the placeholder binding", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p1 = s().addProject({ name: "P1", clientId: c.id, color: "#2" });
    const p2 = s().addProject({ name: "P2", clientId: c.id, color: "#3" });
    const t1 = s().addActivity({
      name: "T1",
      kind: "project",
      projectId: p1.id,
    });
    const t2 = s().addActivity({
      name: "T2",
      kind: "project",
      projectId: p2.id,
    });
    const ph = s().addResource({
      kind: "placeholder",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      halfDays: [],
      color: "#1",
      projectId: p1.id,
    });
    const a = s().addAllocation({
      resourceId: ph.id,
      activityId: t1.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    expect(() => s().updateAllocation(a.id, { activityId: t2.id })).toThrow(/placeholder.*bound project/i);
    expect(s().data.allocations.find((x) => x.id === a.id)!.activityId).toBe(t1.id);
  });

  it("addAllocation rejects dangling resource/activity references", () => {
    expect(() =>
      s().addAllocation({
        resourceId: "nope",
        activityId: "nope",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    ).toThrow(/allocation must reference an existing resource and activity/i);
    expect(s().data.allocations).toHaveLength(0);
  });
});

describe("date-range + reference guards at the store boundary", () => {
  const seedAlloc = () => {
    const c = s().addClient({ name: "Acme", color: "#111111" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#222222" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p.id });
    const r = s().addResource({ ...personDraft });
    return { r, t };
  };

  it("addAllocation rejects an empty or reversed date range", () => {
    const { r, t } = seedAlloc();
    expect(() =>
      s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "",
        endDate: "",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    ).toThrow(/start and end dates are required/i);
    expect(() =>
      s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-05",
        endDate: "2026-06-01",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    ).toThrow(/end date cannot be before the start date/i);
    expect(s().data.allocations).toHaveLength(0);
  });

  it("clamps allocation hoursPerDay to a real working day (<= 24) on add and update", () => {
    const { r, t } = seedAlloc();
    const a = s().addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 200,
      status: "confirmed",
    });
    expect(a.hoursPerDay).toBe(24); // inflated value clamped on add
    s().updateAllocation(a.id, { hoursPerDay: 99 });
    expect(s().data.allocations[0].hoursPerDay).toBe(24); // and on update (e.g. a drag-resize rescale)
  });

  it("updateAllocation allows a note/status-only patch (validates the effective range, not the patch)", () => {
    const { r, t } = seedAlloc();
    const a = s().addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });
    expect(() => s().updateAllocation(a.id, { status: "tentative" })).not.toThrow();
    expect(s().data.allocations[0].status).toBe("tentative");
    // …but a patch that would reverse the range is rejected.
    expect(() => s().updateAllocation(a.id, { endDate: "2026-05-01" })).toThrow(
      /end date cannot be before the start date/i,
    );
    expect(s().data.allocations[0].endDate).toBe("2026-06-03");
  });

  it("addTimeOff rejects a dangling resource and a reversed range", () => {
    const r = s().addResource({ ...personDraft });
    expect(() =>
      s().addTimeOff({
        resourceId: "nope",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        type: "holiday",
      }),
    ).toThrow(/time off must reference an existing resource/i);
    expect(() =>
      s().addTimeOff({
        resourceId: r.id,
        startDate: "2026-06-05",
        endDate: "2026-06-01",
        type: "holiday",
      }),
    ).toThrow(/end date cannot be before the start date/i);
    expect(s().data.timeOff).toHaveLength(0);
  });

  it("addResource / updateResource reject an empty working-days set", () => {
    expect(() => s().addResource({ ...personDraft, workingDays: [] })).toThrow(/at least one working day/i);
    const r = s().addResource({ ...personDraft });
    expect(() => s().updateResource(r.id, { workingDays: [] })).toThrow(/at least one working day/i);
    // A patch that doesn't touch workingDays is unaffected.
    expect(() => s().updateResource(r.id, { name: "Renamed" })).not.toThrow();
  });

  it("requires half days to be a unique subset of the working week", () => {
    expect(() => s().addResource({ ...personDraft, workingDays: [1, 2], halfDays: [3] })).toThrow(
      /half days must be.*contained/i,
    );
    const resource = s().addResource({ ...personDraft, workingDays: [1, 2], halfDays: [2] });
    expect(resource.halfDays).toEqual([2]);
    expect(() => s().updateResource(resource.id, { workingDays: [1] })).toThrow(/half days must be.*contained/i);
    expect(() => s().updateResource(resource.id, { halfDays: [2, 2] })).toThrow(/half days must be unique/i);
  });

  it("normalizes placeholder working patterns on add and update", () => {
    const client = s().addClient({ name: "Wayne Enterprises", color: "#737373" });
    const project = s().addProject({ name: "Watchtower", clientId: client.id, color: "#737373" });
    const resource = s().addResource({
      ...personDraft,
      kind: "placeholder",
      projectId: project.id,
      workingDays: [],
      halfDays: [6],
    });

    expect(resource).toMatchObject({ workingDays: [1, 2, 3, 4, 5], halfDays: [] });
    s().updateResource(resource.id, { workingDays: [0, 6], halfDays: [6] });
    expect(s().data.resources.find((candidate) => candidate.id === resource.id)).toMatchObject({
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
    });
  });

  it("clamps resource workingHoursPerDay to (0, 24] on add and update (0/junk → 8, >24 → 24)", () => {
    // The store is the last line for the resource path too (the form caps it, but a non-form
    // or pre-blur-paste write must not persist NaN / 0 / >24h capacity). 0 is NOT legal for a
    // resource — no working day — so it falls back to 8 (distinct from an allocation, where 0 is fine).
    const over = s().addResource({
      ...personDraft,
      workingHoursPerDay: 1000,
    });
    expect(over.workingHoursPerDay).toBe(24);
    const zero = s().addResource({
      ...personDraft,
      workingHoursPerDay: 0,
    });
    expect(zero.workingHoursPerDay).toBe(8);
    s().updateResource(over.id, { workingHoursPerDay: NaN });
    expect(s().data.resources.find((r) => r.id === over.id)!.workingHoursPerDay).toBe(8); // junk → 8
  });

  it("importData replaces the active account slice and is undoable via ⌘Z", () => {
    s().addClient({ name: "Keep", color: "#111111" });
    s().setFilters({
      clientId: "stale-client",
      search: "retained search",
      hideTentative: true,
      showUnmatched: true,
    });
    s().selectAllocation("stale-allocation");
    s().toggleGroup("discipline:stale-discipline");
    // A non-empty import replaces the slice (a zero-record import is refused — see below).
    const incoming = {
      ...emptyAppData(),
      clients: [
        {
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
    // 'Keep' replaced by the imported client; import also guarantees one built-in Internal client.
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
    expect(s().data.clients.map((c) => c.name)).toEqual(["Keep"]); // undo restores the pre-import slice
  });

  it("importData refuses a zero-record import (no silent wipe)", () => {
    s().addClient({ name: "Keep", color: "#111111" });
    const summary = s().importData(emptyAppData());
    expect(summary.imported).toBe(0);
    expect(s().data.clients.map((c) => c.name)).toEqual(["Keep"]); // untouched
  });
});

// The store re-validates the EFFECTIVE MERGED row on every update*, exactly as the SQLite server's
// validateWrite re-validates the full {...existing, ...patch} row on every write. A note/status/
// date-only edit of a row whose resource is EXTERNAL with a non-zero load / any external time-off
// (legacy pre-v0.8.1 data, or after a resource kind-flip) must therefore be REJECTED by the store too
// — otherwise it succeeds locally and 400s on the server, diverging local and synced state. The
// invalid states below can't be CREATED through add* (they'd be rejected), so they're built directly
// via replaceAll to mimic legacy/kind-flipped data already in the store.
describe("update* re-validates the merged row so the store + server agree", () => {
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

  it("a normal-resource note/date-only updateAllocation + updateTimeOff still succeed (no false reject)", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p.id });
    const r = s().addResource({ ...personDraft });
    const a = s().addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });
    // A note/date-only patch on a VALID (non-external) allocation must NOT be rejected even though
    // the merged-row check now runs unconditionally — assertAllocationRefs is pure & idempotent.
    expect(() => s().updateAllocation(a.id, { note: "ping" })).not.toThrow();
    expect(() => s().updateAllocation(a.id, { startDate: "2026-06-02" })).not.toThrow();
    expect(s().data.allocations[0].note).toBe("ping");
    expect(s().data.allocations[0].startDate).toBe("2026-06-02");

    const to = s().addTimeOff({
      resourceId: r.id,
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      type: "holiday",
    });
    expect(() => s().updateTimeOff(to.id, { type: "sick" })).not.toThrow();
    expect(() => s().updateTimeOff(to.id, { startDate: "2026-06-09" })).not.toThrow();
    expect(s().data.timeOff[0].type).toBe("sick");
  });

  it("a note-only updateAllocation on an external resource carrying a non-zero load now THROWS (matches the server)", () => {
    const ext = externalResource("ext-1");
    const alloc: Allocation = {
      id: "alloc-1",
      accountId: DEFAULT_ACCOUNT_ID,
      createdAt: TS,
      updatedAt: TS,
      resourceId: ext.id,
      activityId: "act-1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      // Legacy / kind-flip data: an external resource with a non-zero load — invalid under the
      // v0.8.1 capacity-free rule. The form/store could never CREATE this; it predates the rule.
      hoursPerDay: 8,
      status: "confirmed",
    };
    const data: AppData = makeAppData({
      resources: [ext],
      activities: [
        {
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

    // A note-only patch touches none of resourceId/activityId/hoursPerDay, yet the merged row still
    // references an external resource with a non-zero load — the server 400s, so the store must too.
    expect(() => s().updateAllocation(alloc.id, { note: "just a note" })).toThrow(/external.*can.t carry hours/i);
    // Atomic failure: the bad patch did NOT land (the producer threw before `set`).
    expect(s().data.allocations[0].note).toBeUndefined();
  });

  it("a date-only updateTimeOff on an external resource now THROWS (matches the server)", () => {
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
    };
    const data: AppData = makeAppData({ resources: [ext], timeOff: [timeOff] });
    s().replaceAll(data);
    s().setActiveAccount(DEFAULT_ACCOUNT_ID);

    // A date-only patch doesn't touch resourceId, yet time-off on an external resource is meaningless
    // (no capacity) — the server rejects it on every write, so the store now matches.
    expect(() => s().updateTimeOff(timeOff.id, { startDate: "2026-06-11" })).toThrow(/external.*3rd-party/i);
    expect(s().data.timeOff[0].startDate).toBe("2026-06-10"); // unchanged — atomic failure
  });

  // The merged-row rule is a property of the SHARED update path (updateOwned), not of the three
  // actions that happened to need it first — so it must hold for a table whose patch carries no
  // ref/date field at all. A rename is the most harmless-looking patch there is.
  it("a name-only updateResource on an external resource that still carries a loaded allocation THROWS", () => {
    const ext = externalResource("ext-3");
    const data: AppData = makeAppData({
      resources: [ext],
      activities: [
        {
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
          id: "alloc-3",
          accountId: DEFAULT_ACCOUNT_ID,
          createdAt: TS,
          updatedAt: TS,
          resourceId: ext.id,
          activityId: "act-3",
          startDate: "2026-06-01",
          endDate: "2026-06-03",
          hoursPerDay: 8, // legacy: an external carrying capacity
          status: "confirmed",
        },
      ],
    });
    s().replaceAll(data);
    s().setActiveAccount(DEFAULT_ACCOUNT_ID);

    // The patch alone (a name) is unimpeachable; the MERGED row is what the server rejects.
    expect(() => s().updateResource(ext.id, { name: "Outsource Co Ltd" })).toThrow(
      /work and time off before making it external/i,
    );
    expect(s().data.resources[0].name).toBe("Outsource Co"); // unchanged — atomic failure
  });
});

// Flipping a resource's kind to 'external' AFTER it already owns loaded work / time-off would orphan
// those dependents (the scheduler hides external capacity + time-off) — recreating the invisible-orphan
// state v0.8.1 closed at the allocation/time-off write boundary. updateResource must REJECT the flip
// (reassign/remove first), throw-before-mutate, exactly as the server's validateWrite does.
// The store's colour-repair idiom (previously copy-pasted per add*/update* action, see git history)
// is now ONE shared helper (withSnappedColor/snapColor) built on the shared snapToPresetColor
// mapper — the SAME mapper server/src/validate.ts's sanitizeWrite('accounts') uses, so client and
// server can never disagree about what a given colour snaps to (see DECISIONS.md). A non-preset
// colour snaps to its NEAREST preset (not a fixed fallback), and a REJECTED write (the P1.12
// viewer no-op) must not silently substitute a colour onto an entity that was never persisted —
// the rejection is surfaced via the store's existing notice mechanism instead.
describe("colour snapping: shared helper, nearest-preset (not fixed fallback), never silent on reject", () => {
  // #7cd9e4 is not a preset; its nearest preset is #7adae3 (distance 6 — see shared/lib/color.test.ts,
  // which pins the same fixture against the full palette).
  const NON_PRESET = "#7cd9e4";
  const NEAREST_PRESET = "#7adae3";

  it("addClient / addProject / addDiscipline / addResource snap a non-preset colour to its nearest preset", () => {
    const client = s().addClient({ name: "Acme", color: NON_PRESET });
    expect(client.color).toBe(NEAREST_PRESET);
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);

    const project = s().addProject({
      name: "P",
      clientId: client.id,
      color: NON_PRESET,
    });
    expect(project.color).toBe(NEAREST_PRESET);

    const discipline = s().addDiscipline({
      name: "Design",
      color: NON_PRESET,
      sortOrder: 0,
    });
    expect(discipline.color).toBe(NEAREST_PRESET);

    const resource = s().addResource({
      ...personDraft,
      color: NON_PRESET,
    });
    expect(resource.color).toBe(NEAREST_PRESET);
  });

  it("updateClient / updateProject / updateDiscipline / updateResource / updateAccount snap a non-preset colour on patch", () => {
    const client = s().addClient({ name: "Acme", color: "#1" });
    s().updateClient(client.id, { color: NON_PRESET });
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);

    const project = s().addProject({
      name: "P",
      clientId: client.id,
      color: "#1",
    });
    s().updateProject(project.id, { color: NON_PRESET });
    expect(s().data.projects.find((p) => p.id === project.id)?.color).toBe(NEAREST_PRESET);

    const discipline = s().addDiscipline({
      name: "Design",
      color: "#1",
      sortOrder: 0,
    });
    s().updateDiscipline(discipline.id, { color: NON_PRESET });
    expect(s().data.disciplines.find((d) => d.id === discipline.id)?.color).toBe(NEAREST_PRESET);

    const resource = s().addResource({
      ...personDraft,
    });
    s().updateResource(resource.id, { color: NON_PRESET });
    expect(s().data.resources.find((r) => r.id === resource.id)?.color).toBe(NEAREST_PRESET);

    s().updateAccount(DEFAULT_ACCOUNT_ID, { color: NON_PRESET });
    expect(s().data.accounts.find((a) => a.id === DEFAULT_ACCOUNT_ID)?.color).toBe(NEAREST_PRESET);
  });

  it("an external resource keeps NEUTRAL_COLOR (the one deliberate non-preset exception) instead of snapping", () => {
    const NEUTRAL_COLOR = "#9ca3af";
    const ext = s().addResource({
      ...personDraft,
      kind: "external",
      color: NEUTRAL_COLOR,
    });
    expect(ext.color).toBe(NEUTRAL_COLOR);
  });

  // Regression: snapColor used to short-circuit on isPresetColor (which only trims/lowercases for
  // the membership CHECK) and return the caller's raw string, so a whitespace/uppercase preset like
  // '  #E02727  ' persisted verbatim in client state while the server's identical mapper stores it
  // normalized — a permanent, un-fixable client/server diff that also broke `===` swatch-picker
  // comparisons. snapColor must always route through snapToPresetColor, whose palette branch already
  // returns the normalized form (see shared/src/lib/color.ts).
  it("a preset colour with stray whitespace/casing is stored normalized, not verbatim", () => {
    const RAW = "  #E02727  ";
    const NORMALIZED = "#e02727";
    const client = s().addClient({ name: "Acme", color: RAW });
    expect(client.color).toBe(NORMALIZED);
    const stored = s().data.clients.find((c) => c.id === client.id)?.color;
    expect(stored).toBe(NORMALIZED);
    // Strictly the SAME string reference-equal-by-value as the actual palette entry, not merely a
    // lookalike '#e02727' — this is what makes a swatch-picker `===` comparison against
    // PRESET_COLORS succeed.
    expect(PRESET_COLORS).toContain(stored);
  });

  it("a colourless patch leaves the stored colour untouched", () => {
    const client = s().addClient({ name: "Acme", color: NON_PRESET });
    s().updateClient(client.id, { name: "Acme 2" });
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);
  });

  it("a REJECTED add (viewer no-op) does NOT snap the colour and does NOT persist — the rejection surfaces via notice, not a silent repair", () => {
    s().setActiveRole("viewer");
    const returned = s().addClient({ name: "Acme", color: NON_PRESET });
    // The store never persisted anything for a viewer — no client landed in state.
    expect(s().data.clients).toHaveLength(0);
    // The rejection is SURFACED (per DEFENSIVE-CODING.md's "surface, never swallow"), not swallowed.
    expect(s().notice).toMatchObject({ tone: "error" });
    // Critically: the unpersisted return value carries the caller's ORIGINAL colour, not a value
    // the store silently changed on their behalf for a write that never actually happened.
    expect(returned.color).toBe(NON_PRESET);
  });

  it("a REJECTED update (viewer no-op) does not touch the stored colour", () => {
    const client = s().addClient({ name: "Acme", color: NON_PRESET });
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);
    s().setActiveRole("viewer");
    s().updateClient(client.id, { color: "#123456" });
    // No-op: the previously-snapped colour is unchanged, not overwritten by ANY value.
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe(NEAREST_PRESET);
    expect(s().notice).toMatchObject({ tone: "error" });
  });
});

describe("updateResource rejects a kind-flip-to-external that would orphan dependents", () => {
  it("flipping a person with a loaded allocation to external THROWS and does not mutate", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p.id });
    const r = s().addResource({ ...personDraft });
    s().addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });

    expect(() => s().updateResource(r.id, { kind: "external" })).toThrow(
      /work and time off before making it external/i,
    );
    expect(s().data.resources[0].kind).toBe("person"); // atomic failure — the flip did NOT land
  });

  it("flipping a person with time off to external THROWS", () => {
    const r = s().addResource({ ...personDraft });
    s().addTimeOff({
      resourceId: r.id,
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      type: "holiday",
    });

    expect(() => s().updateResource(r.id, { kind: "external" })).toThrow(
      /work and time off before making it external/i,
    );
    expect(s().data.resources[0].kind).toBe("person");
  });

  it("flipping a person with NO dependents (or only a zero-load allocation) to external SUCCEEDS", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p = s().addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p.id });
    const free = s().addResource({
      ...personDraft,
      name: "Free",
    });
    expect(() => s().updateResource(free.id, { kind: "external" })).not.toThrow();
    expect(s().data.resources.find((r) => r.id === free.id)?.kind).toBe("external");

    // A zero-load allocation is already valid for an external, so it must NOT block the flip.
    const z = s().addResource({
      ...personDraft,
      name: "Zero",
    });
    s().addAllocation({
      resourceId: z.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 0,
      status: "confirmed",
    });
    expect(() => s().updateResource(z.id, { kind: "external" })).not.toThrow();
    expect(s().data.resources.find((r) => r.id === z.id)?.kind).toBe("external");
  });

  it("editing an external resource’s OTHER fields (name) with no dependents still SUCCEEDS", () => {
    const ext = s().addResource({
      ...personDraft,
      name: "Outsource",
      kind: "external",
    });
    expect(() => s().updateResource(ext.id, { name: "Outsource Co" })).not.toThrow();
    expect(s().data.resources.find((r) => r.id === ext.id)?.name).toBe("Outsource Co");
  });
});

describe("parent edits cannot invalidate existing placeholder allocations", () => {
  it("rejects a placeholder project rebind atomically", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p1 = s().addProject({ name: "P1", clientId: c.id, color: "#2" });
    const p2 = s().addProject({ name: "P2", clientId: c.id, color: "#3" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p1.id });
    const ph = s().addResource({
      ...personDraft,
      kind: "placeholder",
      projectId: p1.id,
    });
    s().addAllocation({
      resourceId: ph.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });

    expect(() => s().updateResource(ph.id, { projectId: p2.id })).toThrow(/placeholder’s work/i);
    expect(s().data.resources.find((resource) => resource.id === ph.id)?.projectId).toBe(p1.id);
  });

  it("rejects an activity project change atomically", () => {
    const c = s().addClient({ name: "Acme", color: "#1" });
    const p1 = s().addProject({ name: "P1", clientId: c.id, color: "#2" });
    const p2 = s().addProject({ name: "P2", clientId: c.id, color: "#3" });
    const t = s().addActivity({ name: "T", kind: "project", projectId: p1.id });
    const ph = s().addResource({
      ...personDraft,
      kind: "placeholder",
      projectId: p1.id,
    });
    s().addAllocation({
      resourceId: ph.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });

    expect(() => s().updateActivity(t.id, { projectId: p2.id })).toThrow(/placeholder work/i);
    expect(s().data.activities.find((activityRow) => activityRow.id === t.id)?.projectId).toBe(p1.id);
  });
});
