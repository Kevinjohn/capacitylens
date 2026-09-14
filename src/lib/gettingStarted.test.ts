import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGettingStartedSteps,
  hasCompletedAllSteps,
  hasExistingSetupData,
  isGettingStartedComplete,
  readGettingStartedProgress,
  writeGettingStartedProgress,
} from "./gettingStarted";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Activity, Allocation, AppData, Client, Project, Resource } from "@capacitylens/shared/types/entities";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const NOW = "2026-06-03T12:00:00.000Z";
const entity = { accountId: "a1", createdAt: NOW, updatedAt: NOW };
const client = (over: Partial<Client> = {}): Client => ({
  id: "c1",
  name: "Wayne Enterprises",
  color: "#123456",
  ...entity,
  ...over,
});
const project = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "Launch",
  clientId: "c1",
  color: "#123456",
  ...entity,
  ...over,
});
const activity = (over: Partial<Activity> = {}): Activity => ({
  id: "t1",
  name: "Planning",
  kind: "internal",
  ...entity,
  ...over,
});
const person = (over: Partial<Resource> = {}): Resource => ({
  id: "r1",
  kind: "person",
  name: "Bruce Wayne",
  role: "Designer",
  employmentType: "permanent",
  engagement: "studio",
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#123456",
  ...entity,
  ...over,
});
const allocation = (over: Partial<Allocation> = {}): Allocation => ({
  id: "al1",
  resourceId: "r1",
  activityId: "t1",
  startDate: "2026-06-03",
  endDate: "2026-06-03",
  hoursPerDay: 0,
  status: "tentative",
  ...entity,
  ...over,
});
const dataWith = (slices: Partial<AppData>): AppData => ({ ...emptyAppData(), ...slices });

describe("first-use outcome truth table", () => {
  it("starts with all three outcomes incomplete", () => {
    expect(buildGettingStartedSteps(emptyAppData())).toEqual({ person: false, work: false, scheduled: false });
  });

  it.each([
    ["person", person(), true],
    ["placeholder", person({ kind: "placeholder", projectId: "p1" }), false],
    ["external", person({ kind: "external" }), false],
  ] as const)("classifies an active %s resource for the person outcome", (_name, resource, expected) => {
    expect(buildGettingStartedSteps(dataWith({ resources: [resource] })).person).toBe(expected);
  });

  it("does not count archived or deleted people", () => {
    expect(buildGettingStartedSteps(dataWith({ resources: [person({ archivedAt: NOW })] })).person).toBe(false);
    expect(
      buildGettingStartedSteps(dataWith({ resources: [person({ archivedAt: NOW, deletedAt: NOW })] })).person,
    ).toBe(false);
  });

  it.each([
    ["internal", activity({ kind: "internal" }), [], [], true],
    ["unattributed repeatable", activity({ kind: "repeatable" }), [], [], true],
    [
      "project activity with active ancestry",
      activity({ kind: "project", projectId: "p1" }),
      [project()],
      [client()],
      true,
    ],
    ["project activity without a project", activity({ kind: "project", projectId: "missing" }), [], [client()], false],
    ["project activity without a client", activity({ kind: "project", projectId: "p1" }), [project()], [], false],
  ] as const)(
    "classifies %s for the work outcome",
    (
      _name,
      work,
      projects,
      clients,
      expected,
      // eslint-disable-next-line max-params -- each named truth-table dimension is independently significant
    ) => {
      expect(
        buildGettingStartedSteps(dataWith({ activities: [work], projects: [...projects], clients: [...clients] })).work,
      ).toBe(expected);
    },
  );

  it("does not let a dangling project activity hide a coherent activity", () => {
    const steps = buildGettingStartedSteps(
      dataWith({
        activities: [activity({ kind: "project", projectId: "missing" }), activity({ id: "t2", kind: "internal" })],
      }),
    );
    expect(steps.work).toBe(true);
  });

  it("does not count inactive work or project ancestry", () => {
    expect(buildGettingStartedSteps(dataWith({ activities: [activity({ archivedAt: NOW })] })).work).toBe(false);
    expect(
      buildGettingStartedSteps(
        dataWith({
          activities: [activity({ kind: "project", projectId: "p1" })],
          projects: [project({ archivedAt: NOW })],
          clients: [client()],
        }),
      ).work,
    ).toBe(false);
    expect(
      buildGettingStartedSteps(
        dataWith({
          activities: [activity({ kind: "project", projectId: "p1" })],
          projects: [project()],
          clients: [client({ deletedAt: NOW })],
        }),
      ).work,
    ).toBe(false);
  });

  it.each([
    ["zero-hour allocation", allocation(), person(), activity(), [], [], true],
    ["missing person", allocation({ resourceId: "missing" }), person(), activity(), [], [], false],
    ["placeholder assignee", allocation(), person({ kind: "placeholder", projectId: "p1" }), activity(), [], [], false],
    ["external assignee", allocation(), person({ kind: "external" }), activity(), [], [], false],
    ["missing activity", allocation({ activityId: "missing" }), person(), activity(), [], [], false],
    [
      "dangling project activity",
      allocation(),
      person(),
      activity({ kind: "project", projectId: "missing" }),
      [],
      [],
      false,
    ],
    [
      "coherent project activity",
      allocation(),
      person(),
      activity({ kind: "project", projectId: "p1" }),
      [project()],
      [client()],
      true,
    ],
    ["unattributed repeatable", allocation(), person(), activity({ kind: "repeatable" }), [], [], true],
    [
      "attributed repeatable with ancestry",
      allocation({ projectId: "p1" }),
      person(),
      activity({ kind: "repeatable" }),
      [project()],
      [client()],
      true,
    ],
    [
      "attributed repeatable without project",
      allocation({ projectId: "missing" }),
      person(),
      activity({ kind: "repeatable" }),
      [],
      [client()],
      false,
    ],
    [
      "attributed repeatable without client",
      allocation({ projectId: "p1" }),
      person(),
      activity({ kind: "repeatable" }),
      [project()],
      [],
      false,
    ],
  ] as const)(
    "classifies %s for the scheduled outcome",
    // eslint-disable-next-line max-params -- each named truth-table dimension is independently significant
    (_name, booked, resource, work, projects, clients, expected) => {
      const steps = buildGettingStartedSteps(
        dataWith({
          allocations: [booked],
          resources: [resource],
          activities: [work],
          projects: [...projects],
          clients: [...clients],
        }),
      );
      expect(steps.scheduled).toBe(expected);
    },
  );

  it("requires all useful outcomes regardless of legacy markers", () => {
    const complete = { person: true, work: true, scheduled: true };
    expect(hasCompletedAllSteps(complete)).toBe(true);
    expect(
      isGettingStartedComplete(complete, {
        started: true,
        importChosen: true,
        scratchChosen: true,
        settingsReviewed: false,
      }),
    ).toBe(true);
    expect(
      isGettingStartedComplete(
        { ...complete, scheduled: false },
        { started: true, importChosen: true, scratchChosen: true, settingsReviewed: true },
      ),
    ).toBe(false);
  });

  it("treats partial meaningful data as existing setup data", () => {
    const none = { person: false, work: false, scheduled: false };
    expect(hasExistingSetupData(dataWith({ clients: [client()] }), none)).toBe(true);
    expect(hasExistingSetupData(dataWith({ projects: [project()] }), none)).toBe(true);
    expect(hasExistingSetupData(dataWith({ clients: [buildInternalClient("a1", NOW)] }), none)).toBe(false);
    expect(hasExistingSetupData(emptyAppData(), none)).toBe(false);
  });
});

describe("onboarding progress persistence", () => {
  it("keeps the tolerant legacy payload parser", () => {
    localStorage.setItem(
      "capacitylens/gettingStartedProgress/a1",
      JSON.stringify({
        started: true,
        importChosen: true,
        scratchChosen: true,
        settingsReviewed: true,
        future: "ignored",
      }),
    );
    expect(readGettingStartedProgress("a1")).toEqual({
      started: true,
      importChosen: true,
      scratchChosen: true,
      settingsReviewed: true,
    });
  });

  it("uses empty progress and a safe warning when saved JSON is malformed", () => {
    localStorage.setItem("capacitylens/gettingStartedProgress/private-account-id", '{"started":true');
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readGettingStartedProgress("private-account-id")).toEqual({
      started: false,
      importChosen: false,
      scratchChosen: false,
      settingsReviewed: false,
    });
    expect(warning).toHaveBeenCalledWith("gettingStarted: saved progress could not be parsed; using empty progress");
  });

  it("does not throw when device storage rejects a read or write", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
      throw new Error("private");
    });
    expect(readGettingStartedProgress("a1").started).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("private");
    });
    expect(() =>
      writeGettingStartedProgress("a1", {
        started: true,
        importChosen: false,
        scratchChosen: false,
        settingsReviewed: false,
      }),
    ).not.toThrow();
    expect(warning).toHaveBeenCalledTimes(2);
  });
});
