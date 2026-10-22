import { describe, it, expect } from "vitest";
import {
  deleteActivityCascade,
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
} from "./cascades";
import {
  CASCADE_REVISION,
  assertEntityById,
  danglingPhaseData,
  person,
  sampleData,
  siblingClientData,
  siblingProjectData,
} from "./integrity.testSupport";

function registerResourceCascadeTests(): void {
  it("deleteResourceCascade removes the resource, its allocations and time off", () => {
    const next = deleteResourceCascade(sampleData(), "r1");
    expect(next.resources.map((r) => r.id)).toEqual(["ph1"]);
    expect(next.allocations.map((a) => a.id)).toEqual(["a2"]);
    expect(next.timeOff).toHaveLength(0);
  });

  it("deleteResourceCascade keeps allocations and time off belonging to OTHER resources", () => {
    // The filters must key on resourceId, not blanket-drop, a co-worker's time off survives.
    const data = sampleData();
    data.timeOff.push({
      id: "to2",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "ph1",
      startDate: "2026-06-20",
      endDate: "2026-06-21",
      type: "sick",
    });
    const next = deleteResourceCascade(data, "r1");
    expect(next.timeOff.map((t) => t.id)).toEqual(["to2"]);
    expect(next.allocations.map((a) => a.id)).toEqual(["a2"]);
  });

  it("deleteActivityCascade removes the activity and its allocations", () => {
    const next = deleteActivityCascade(sampleData(), "t1");
    expect(next.activities.map((t) => t.id)).toEqual(["t2"]);
    expect(next.allocations.map((a) => a.id)).toEqual(["a2"]);
  });
}

function registerPhaseCascadeTests(): void {
  it("deletePhaseCascade ungroups activities but keeps them", () => {
    const next = deletePhaseCascade(sampleData(), "phase1", CASCADE_REVISION);
    expect(next.phases).toHaveLength(0);
    expect(assertEntityById(next.activities, "t1").phaseId).toBeUndefined();
    expect(next.activities).toHaveLength(2);
  });

  it("deletePhaseCascade only removes the TARGET phase and only ungroups ITS activities", () => {
    // A sibling phase survives untouched, and an activity grouped under the sibling keeps its
    // phaseId: only activities pointing at the deleted phase are ungrouped.
    const data = sampleData();
    data.phases.push({
      id: "phase2",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Build",
      projectId: "p1",
    });
    data.activities.push({
      id: "t3",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Dev",
      kind: "project",
      projectId: "p1",
      phaseId: "phase2",
    });
    const next = deletePhaseCascade(data, "phase1", CASCADE_REVISION);
    expect(next.phases.map((p) => p.id)).toEqual(["phase2"]);
    expect(assertEntityById(next.activities, "t3").phaseId).toBe("phase2");
    expect(assertEntityById(next.activities, "t1").phaseId).toBeUndefined();
  });
}

function registerProjectCascadeTests(): void {
  it("deleteProjectCascade removes project, phases, activities, their allocations, and unbinds placeholders", () => {
    const next = deleteProjectCascade(sampleData(), "p1", CASCADE_REVISION);
    expect(next.projects).toHaveLength(0);
    expect(next.phases).toHaveLength(0);
    expect(next.activities).toHaveLength(0);
    expect(next.allocations).toHaveLength(0);
    expect(assertEntityById(next.resources, "ph1").projectId).toBeUndefined();
    expect(next.resources).toHaveLength(2);
  });

  it("deleteProjectCascade leaves general (no-project) activities and their allocations intact", () => {
    const data = sampleData();
    data.activities.push({
      id: "t3",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Admin",
      kind: "repeatable",
    });
    data.allocations.push({
      id: "a3",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "t3",
      startDate: "2026-06-05",
      endDate: "2026-06-06",
      hoursPerDay: 8,
      status: "confirmed",
      projectId: "p1",
    });
    const next = deleteProjectCascade(data, "p1", CASCADE_REVISION);
    expect(next.activities.map((t) => t.id)).toEqual(["t3"]);
    expect(next.allocations.map((a) => a.id)).toEqual(["a3"]);
    expect(next.allocations[0]?.projectId).toBeUndefined();
    expect(next.allocations[0]?.updatedAt).toBe(CASCADE_REVISION);
  });

  it("deleteProjectCascade unbinds a surviving activity’s phaseId that pointed at a deleted phase", () => {
    // t-keep belongs to p2 but (incoherently) references phase ph-p1, which belongs to p1.
    // Deleting p1 removes ph-p1; t-keep must survive with its phaseId unbound, never a
    // dangling reference (mirrors the server FK's ON DELETE SET NULL).
    const data = danglingPhaseData();
    const revision = "2026-07-15T00:00:00.000Z";
    const next = deleteProjectCascade(data, "p1", revision);
    const keep = assertEntityById(next.activities, "t-keep");
    expect(keep.phaseId).toBeUndefined();
    expect(keep.updatedAt).toBe(revision);
    expect(next.phases).toHaveLength(0);
  });

  it("deleteProjectCascade spares a SIBLING project’s phases, activities, allocations and bound placeholder", () => {
    // Deleting p1 must touch only p1's subtree: p2 and everything coherently under it survives,
    // and a coherent p2 activity keeps its (p2) phase. The removed-phase set must not over-collect.
    const data = siblingProjectData();
    const next = deleteProjectCascade(data, "p1", CASCADE_REVISION);
    expect(next.projects.map((p) => p.id)).toEqual(["p2"]);
    expect(next.phases.map((p) => p.id)).toEqual(["ph-p2"]);
    expect(next.activities.map((t) => t.id)).toEqual(["a-p2"]);
    expect(assertEntityById(next.activities, "a-p2").phaseId).toBe("ph-p2");
    expect(next.allocations.map((a) => a.id)).toEqual(["al-p2"]);
    expect(assertEntityById(next.resources, "ph2").projectId).toBe("p2");
  });
}

function registerClientCascadeTests(): void {
  it("deleteClientCascade cascades through its projects", () => {
    const data = sampleData();
    data.activities.push({
      id: "shared",
      accountId: "acct-test",
      name: "Shared",
      kind: "repeatable",
      createdAt: "t",
      updatedAt: "t",
    });
    data.allocations.push({
      id: "attributed",
      accountId: "acct-test",
      resourceId: "r1",
      activityId: "shared",
      projectId: "p1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      hoursPerDay: 8,
      status: "confirmed",
      createdAt: "t",
      updatedAt: "t",
    });
    const next = deleteClientCascade(data, "c1", CASCADE_REVISION);
    expect(next.clients).toHaveLength(0);
    expect(next.projects).toHaveLength(0);
    expect(next.activities.map((activity) => activity.id)).toEqual(["shared"]);
    expect(next.allocations.map((allocation) => allocation.id)).toEqual(["attributed"]);
    expect(next.allocations[0]?.projectId).toBeUndefined();
    expect(next.allocations[0]?.updatedAt).toBe(CASCADE_REVISION);
    expect(assertEntityById(next.resources, "ph1").projectId).toBeUndefined();
  });

  it("deleteClientCascade removes ONLY the target client’s subtree, sparing a sibling client", () => {
    // Two clients; deleting c1 leaves c2's project/phase/activity/allocation/placeholder intact.
    // A c2 activity that (incoherently) points at a c1 phase survives with its phaseId unbound.
    const data = siblingClientData();
    const revision = "2026-07-15T00:00:00.000Z";
    const next = deleteClientCascade(data, "c1", revision);
    expect(next.clients.map((c) => c.id)).toEqual(["c2"]);
    expect(next.projects.map((p) => p.id)).toEqual(["p2"]);
    expect(next.phases.map((p) => p.id)).toEqual(["ph2"]);
    expect(next.activities.map((t) => t.id).sort()).toEqual(["a2", "a3"]);
    const survivingActivity = assertEntityById(next.activities, "a2");
    expect(survivingActivity.name).toBe("A2");
    expect(survivingActivity.phaseId).toBe("ph2");
    const repairedActivity = assertEntityById(next.activities, "a3");
    expect(repairedActivity.phaseId).toBeUndefined();
    expect(repairedActivity.updatedAt).toBe(revision);
    expect(next.allocations.map((a) => a.id)).toEqual(["al2"]);
    expect(assertEntityById(next.resources, "phc1").projectId).toBeUndefined();
    expect(assertEntityById(next.resources, "phc2").projectId).toBe("p2");
  });
}

function registerDisciplineCascadeTests(): void {
  it("deleteDisciplineCascade ungroups resources but keeps them", () => {
    const next = deleteDisciplineCascade(sampleData(), "d1", CASCADE_REVISION);
    expect(next.disciplines).toHaveLength(0);
    expect(next.resources.every((r) => r.disciplineId === undefined)).toBe(true);
    expect(next.resources).toHaveLength(2);
  });

  it("deleteDisciplineCascade keeps OTHER disciplines and only ungroups its own resources", () => {
    const data = sampleData();
    data.disciplines.push({
      id: "d2",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Dev",
      sortOrder: 1,
    });
    data.resources.push(person({ id: "r2", disciplineId: "d2" }));
    const next = deleteDisciplineCascade(data, "d1", CASCADE_REVISION);
    expect(next.disciplines.map((d) => d.id)).toEqual(["d2"]);
    expect(assertEntityById(next.resources, "r2").disciplineId).toBe("d2");
    const r1 = assertEntityById(next.resources, "r1");
    expect(r1.disciplineId).toBeUndefined();
    expect(r1.role).toBe("Senior Designer");
  });

  it("stamps surviving records whose foreign key is cleared by a cascade", () => {
    const revision = "2026-07-15T00:00:00.000Z";

    const afterPhase = deletePhaseCascade(sampleData(), "phase1", revision);
    const activityWithoutPhase = afterPhase.activities.find((activity) => activity.id === "t1");
    expect(activityWithoutPhase).toMatchObject({ id: "t1", updatedAt: revision });
    expect(activityWithoutPhase).not.toHaveProperty("phaseId");

    const afterProject = deleteProjectCascade(sampleData(), "p1", revision);
    const projectlessAfterProject = afterProject.resources.find((resource) => resource.id === "ph1");
    expect(projectlessAfterProject).toMatchObject({ id: "ph1", updatedAt: revision });
    expect(projectlessAfterProject).not.toHaveProperty("projectId");

    const afterClient = deleteClientCascade(sampleData(), "c1", revision);
    const projectlessAfterClient = afterClient.resources.find((resource) => resource.id === "ph1");
    expect(projectlessAfterClient).toMatchObject({ id: "ph1", updatedAt: revision });
    expect(projectlessAfterClient).not.toHaveProperty("projectId");

    const afterDiscipline = deleteDisciplineCascade(sampleData(), "d1", revision);
    const undisciplined = afterDiscipline.resources.find((resource) => resource.id === "r1");
    expect(undisciplined).toMatchObject({ id: "r1", updatedAt: revision });
    expect(undisciplined).not.toHaveProperty("disciplineId");
  });

  it("does not mutate the input", () => {
    const data = sampleData();
    const snapshot = JSON.stringify(data);
    deleteClientCascade(data, "c1", CASCADE_REVISION);
    expect(JSON.stringify(data)).toBe(snapshot);
  });
}

describe("cascade deletes", () => {
  registerResourceCascadeTests();
  registerPhaseCascadeTests();
  registerProjectCascadeTests();
  registerClientCascadeTests();
  registerDisciplineCascadeTests();
});
