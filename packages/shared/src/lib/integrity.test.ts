import { NULLABLE_FIELDS } from "../types/nullableFields.js";
import { describe, it, expect } from "vitest";
import {
  allocationAttributionAllowed,
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
  deleteActivityCascade,
  isValidISODate,
  parseISOTimestamp,
  validateAllocationAssignment,
  validateDateRange,
  validateProjectClient,
  withoutAllocationAttribution,
} from "./integrity.js";
import type { AppData } from "../types/entities.js";
import { addDaysISO } from "./dateMath.js";
import { MAX_SPAN_DAYS } from "./schedulingDays.js";
import {
  placeholder,
  unboundPlaceholder,
  person,
  assertEntityById,
  sampleData,
  danglingPhaseData,
  siblingProjectData,
  siblingClientData,
} from "./integrity.test.support.js";

const CASCADE_REVISION = "2026-07-15T00:00:00.000Z";

describe("allocationAttributionAllowed", () => {
  it("allows allocation-level project attribution only for repeatable activities", () => {
    expect(allocationAttributionAllowed("repeatable")).toBe(true);
    expect(allocationAttributionAllowed("project")).toBe(false);
    expect(allocationAttributionAllowed("internal")).toBe(false);
    expect(allocationAttributionAllowed("unknown")).toBe(false);
  });
});

describe("withoutAllocationAttribution", () => {
  it("returns a restamped copy without projectId", () => {
    const original = { id: "al1", projectId: "p1", updatedAt: "before" };
    expect(withoutAllocationAttribution(original, "after")).toEqual({ id: "al1", projectId: null, updatedAt: "after" });
    expect(original).toHaveProperty("projectId", "p1");
  });
});

describe("validateProjectClient", () => {
  it("requires a client", () => {
    expect(validateProjectClient("c1").ok).toBe(true);
    expect(validateProjectClient("").ok).toBe(false);
    expect(validateProjectClient(undefined).ok).toBe(false);
  });
});

describe("isValidISODate", () => {
  it("accepts real dates skipped by local time zones and rejects malformed or impossible ones", () => {
    expect(isValidISODate("2026-06-01")).toBe(true);
    expect(isValidISODate("nope")).toBe(false);
    expect(isValidISODate("x2026-06-01")).toBe(false);
    expect(isValidISODate("2026-06-01x")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("0000-01-01")).toBe(false);
    expect(isValidISODate("2011-12-30")).toBe(true);
    expect(isValidISODate("1994-12-31")).toBe(true);
  });

  it("rejects a NON-STRING even when it stringifies to a valid-looking date", () => {
    // Non-string values must fail before regex matching so coercible arrays cannot masquerade as valid dates.
    expect(isValidISODate(null)).toBe(false);
    expect(isValidISODate(20260601)).toBe(false);
    expect(isValidISODate(["2026-06-01"])).toBe(false);
  });
});

describe("parseISOTimestamp", () => {
  it("accepts canonical UTC, supported fractional precision, and explicit offsets", () => {
    expect(parseISOTimestamp("2026-01-01T00:00:00.000Z")).toBe(Date.UTC(2026, 0, 1));
    expect(parseISOTimestamp("2026-01-01T00:00:00.1Z")).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 100));
    expect(parseISOTimestamp("2026-01-01T01:00:00+01:00")).toBe(Date.UTC(2026, 0, 1));
    expect(parseISOTimestamp("2024-02-29T12:00:00Z")).toBe(Date.UTC(2024, 1, 29, 12));
  });

  it.each([
    "0",
    "01/01/2000",
    "2026-01-01T00:00:00",
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00.1234Z",
  ])("rejects malformed, rolled, or unsupported timestamp %s", (value) => {
    expect(parseISOTimestamp(value)).toBeNull();
  });
});

describe("validateDateRange", () => {
  it("accepts a normal range and a single day", () => {
    expect(validateDateRange("2026-06-01", "2026-06-05").ok).toBe(true);
    expect(validateDateRange("2026-06-01", "2026-06-01").ok).toBe(true);
  });
  it("rejects a missing end or start", () => {
    expect(validateDateRange("2026-06-01", "").ok).toBe(false);
    expect(validateDateRange("", "2026-06-01").ok).toBe(false);
    expect(validateDateRange(undefined, undefined).ok).toBe(false);
  });
  it("rejects a reversed range", () => {
    const v = validateDateRange("2026-06-05", "2026-06-01");
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/before the start/i);
  });
  it("accepts the maximum calendar span and rejects one day more", () => {
    const start = "2026-01-01";
    expect(validateDateRange(start, addDaysISO(start, MAX_SPAN_DAYS - 1)).ok).toBe(true);
    expect(validateDateRange(start, addDaysISO(start, MAX_SPAN_DAYS))).toEqual({
      ok: false,
      errors: ["Date span cannot exceed 36,500 calendar days."],
      codes: ["date_span_too_long"],
    });
  });
  it("rejects non-zero-padded and out-of-range dates (the invariant isWithin relies on)", () => {
    // A non-padded "2026-6-1" would break isWithin's lexicographic compare, so it must
    // never pass this write-boundary guard.
    expect(validateDateRange("2026-6-1", "2026-06-05").ok).toBe(false);
    expect(validateDateRange("2026-06-01", "2026-6-5").ok).toBe(false);
    expect(validateDateRange("2026-13-01", "2026-12-01").ok).toBe(false);
    expect(validateDateRange("2026-02-30", "2026-03-05").ok).toBe(false);
    expect(validateDateRange("2026-13-01", "2026-12-01").errors[0]).toMatch(/valid calendar dates/i);
  });
});

describe("placeholder binding", () => {
  it("a person can be assigned any project activity", () => {
    expect(validateAllocationAssignment(person(), "anything").ok).toBe(true);
  });

  it("a placeholder can only be assigned activities from its bound project", () => {
    const ph = placeholder({ projectId: "p1" });
    expect(validateAllocationAssignment(ph, "p1").ok).toBe(true);
    expect(validateAllocationAssignment(ph, "p2").ok).toBe(false);
  });

  it("validateAllocationAssignment explains the rejection", () => {
    expect(validateAllocationAssignment(placeholder({ projectId: "p1" }), "p2").ok).toBe(false);
    expect(validateAllocationAssignment(unboundPlaceholder(), "p1").ok).toBe(false);
    expect(validateAllocationAssignment(placeholder({ projectId: "p1" }), "p1").ok).toBe(true);
    expect(validateAllocationAssignment(person(), "p1").ok).toBe(true);
  });

  it("distinguishes an UNBOUND placeholder from a wrong-project one by message", () => {
    // An unbound placeholder (no projectId) and one bound to the wrong project both reject,
    // but with different reasons, so the `!resource.projectId` branch and each message string
    // are load-bearing, not interchangeable.
    expect(validateAllocationAssignment(unboundPlaceholder(), "p1").errors[0]).toMatch(/not bound to a project/i);
    expect(validateAllocationAssignment(placeholder({ projectId: "p1" }), "p2").errors[0]).toMatch(
      /only be assigned to activities from its bound project/i,
    );
  });

  it("a general (no-project) activity can be assigned to anyone — people and placeholders", () => {
    expect(validateAllocationAssignment(person(), undefined).ok).toBe(true);
    // The project restriction does not bite when the activity has no project.
    expect(validateAllocationAssignment(placeholder({ projectId: "p1" }), undefined).ok).toBe(true);
    expect(validateAllocationAssignment(unboundPlaceholder(), undefined).ok).toBe(true);
  });
});

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
      note: null,
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
    expect(assertEntityById(next.activities, "t1").phaseId).toBeNull();
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
      ...NULLABLE_FIELDS.activities,
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
    expect(assertEntityById(next.activities, "t1").phaseId).toBeNull();
  });
}

function projectDataWithGeneralActivity(): AppData {
  const data = sampleData();
  data.activities.push({
    ...NULLABLE_FIELDS.activities,
    id: "t3",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    name: "Admin",
    kind: "repeatable",
  });
  data.allocations.push({
    ...NULLABLE_FIELDS.allocations,
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
  return data;
}

function registerProjectCascadeTests(): void {
  it("deleteProjectCascade removes project, phases, activities, their allocations, and unbinds placeholders", () => {
    const next = deleteProjectCascade(sampleData(), "p1", CASCADE_REVISION);
    expect(next.projects).toHaveLength(0);
    expect(next.phases).toHaveLength(0);
    expect(next.activities).toHaveLength(0);
    expect(next.allocations).toHaveLength(0);
    expect(assertEntityById(next.resources, "ph1").projectId).toBeNull();
    expect(next.resources).toHaveLength(2);
  });

  it("deleteProjectCascade leaves general (no-project) activities and their allocations intact", () => {
    const next = deleteProjectCascade(projectDataWithGeneralActivity(), "p1", CASCADE_REVISION);
    expect(next.activities.map((t) => t.id)).toEqual(["t3"]);
    expect(next.allocations.map((a) => a.id)).toEqual(["a3"]);
    expect(next.allocations[0]?.projectId).toBeNull();
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
    expect(keep.phaseId).toBeNull();
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
      ...NULLABLE_FIELDS.activities,
      id: "shared",
      accountId: "acct-test",
      name: "Shared",
      kind: "repeatable",
      createdAt: "t",
      updatedAt: "t",
    });
    data.allocations.push({
      ...NULLABLE_FIELDS.allocations,
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
    expect(next.allocations[0]?.projectId).toBeNull();
    expect(next.allocations[0]?.updatedAt).toBe(CASCADE_REVISION);
    expect(assertEntityById(next.resources, "ph1").projectId).toBeNull();
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
    expect(repairedActivity.phaseId).toBeNull();
    expect(repairedActivity.updatedAt).toBe(revision);
    expect(next.allocations.map((a) => a.id)).toEqual(["al2"]);
    expect(assertEntityById(next.resources, "phc1").projectId).toBeNull();
    expect(assertEntityById(next.resources, "phc2").projectId).toBe("p2");
  });
}

function registerDisciplineCascadeTests(): void {
  it("deleteDisciplineCascade ungroups resources but keeps them", () => {
    const next = deleteDisciplineCascade(sampleData(), "d1", CASCADE_REVISION);
    expect(next.disciplines).toHaveLength(0);
    expect(next.resources.every((r) => r.disciplineId === null)).toBe(true);
    expect(next.resources).toHaveLength(2);
  });

  it("deleteDisciplineCascade keeps OTHER disciplines and only ungroups its own resources", () => {
    const data = sampleData();
    data.disciplines.push({
      ...NULLABLE_FIELDS.disciplines,
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
    expect(r1.disciplineId).toBeNull();
    expect(r1.role).toBe("Senior Designer");
  });

  it("stamps surviving records whose foreign key is cleared by a cascade", () => {
    const revision = "2026-07-15T00:00:00.000Z";

    const afterPhase = deletePhaseCascade(sampleData(), "phase1", revision);
    const activityWithoutPhase = afterPhase.activities.find((activity) => activity.id === "t1");
    expect(activityWithoutPhase).toMatchObject({ id: "t1", updatedAt: revision });
    expect(activityWithoutPhase).toHaveProperty("phaseId", null);

    const afterProject = deleteProjectCascade(sampleData(), "p1", revision);
    const projectlessAfterProject = afterProject.resources.find((resource) => resource.id === "ph1");
    expect(projectlessAfterProject).toMatchObject({ id: "ph1", updatedAt: revision });
    expect(projectlessAfterProject).toHaveProperty("projectId", null);

    const afterClient = deleteClientCascade(sampleData(), "c1", revision);
    const projectlessAfterClient = afterClient.resources.find((resource) => resource.id === "ph1");
    expect(projectlessAfterClient).toMatchObject({ id: "ph1", updatedAt: revision });
    expect(projectlessAfterClient).toHaveProperty("projectId", null);

    const afterDiscipline = deleteDisciplineCascade(sampleData(), "d1", revision);
    const undisciplined = afterDiscipline.resources.find((resource) => resource.id === "r1");
    expect(undisciplined).toMatchObject({ id: "r1", updatedAt: revision });
    expect(undisciplined).toHaveProperty("disciplineId", null);
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
