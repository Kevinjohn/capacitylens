import { describe, expect, it } from "vitest";
import { buildGettingStartedSteps, hasCompletedAllSteps, isGettingStartedComplete } from "./gettingStarted";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Activity, Allocation, AppData, Client, Project, Resource } from "@capacitylens/shared/types/entities";
import { FIXTURE_RESOURCE_EXTERNAL } from "@capacitylens/shared/data/fixtures";

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
  it("starts with all five outcomes incomplete", () => {
    expect(buildGettingStartedSteps(emptyAppData())).toEqual({
      person: false,
      client: false,
      project: false,
      activity: false,
      scheduled: false,
    });
  });

  it.each([
    ["person", person(), true],
    ["placeholder", person({ kind: "placeholder", projectId: "p1" }), false],
    ["external", FIXTURE_RESOURCE_EXTERNAL, false],
  ] as const)("classifies an active %s resource for the person outcome", (_name, resource, expected) => {
    expect(buildGettingStartedSteps(dataWith({ resources: [resource] })).person).toBe(expected);
  });

  it("does not count archived or deleted people", () => {
    expect(buildGettingStartedSteps(dataWith({ resources: [person({ archivedAt: NOW })] })).person).toBe(false);
    expect(
      buildGettingStartedSteps(dataWith({ resources: [person({ archivedAt: NOW, deletedAt: NOW })] })).person,
    ).toBe(false);
  });

  it("treats malformed lifecycle tombstones as active, matching activeOnly", () => {
    const malformed = "not-a-date";
    const malformedPerson = person({ archivedAt: malformed, deletedAt: malformed });
    const malformedClient = client({ archivedAt: malformed, deletedAt: malformed });
    const malformedProject = project({ archivedAt: malformed, deletedAt: malformed });
    const malformedActivity = activity({
      kind: "project",
      projectId: "p1",
      archivedAt: malformed,
      deletedAt: malformed,
    });
    expect(buildGettingStartedSteps(dataWith({ resources: [malformedPerson] })).person).toBe(true);
    expect(
      buildGettingStartedSteps(
        dataWith({ clients: [malformedClient], projects: [malformedProject], activities: [malformedActivity] }),
      ).activity,
    ).toBe(true);
    expect(buildGettingStartedSteps(dataWith({ clients: [malformedClient] })).client).toBe(true);
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
        buildGettingStartedSteps(dataWith({ activities: [work], projects: [...projects], clients: [...clients] }))
          .activity,
      ).toBe(expected);
    },
  );

  it("does not let a dangling project activity hide a coherent activity", () => {
    const steps = buildGettingStartedSteps(
      dataWith({
        activities: [activity({ kind: "project", projectId: "missing" }), activity({ id: "t2", kind: "internal" })],
      }),
    );
    expect(steps.activity).toBe(true);
  });

  it("does not count inactive work or project ancestry", () => {
    expect(buildGettingStartedSteps(dataWith({ activities: [activity({ archivedAt: NOW })] })).activity).toBe(false);
    expect(
      buildGettingStartedSteps(
        dataWith({
          activities: [activity({ kind: "project", projectId: "p1" })],
          projects: [project({ archivedAt: NOW })],
          clients: [client()],
        }),
      ).activity,
    ).toBe(false);
    expect(
      buildGettingStartedSteps(
        dataWith({
          activities: [activity({ kind: "project", projectId: "p1" })],
          projects: [project()],
          clients: [client({ deletedAt: NOW })],
        }),
      ).activity,
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

  it("requires all five outcomes", () => {
    const complete = { person: true, client: true, project: true, activity: true, scheduled: true };
    expect(hasCompletedAllSteps(complete)).toBe(true);
    expect(isGettingStartedComplete(complete)).toBe(true);
    expect(isGettingStartedComplete({ ...complete, scheduled: false })).toBe(false);
  });

  it("counts client and project independently, excluding the built-in client", () => {
    expect(buildGettingStartedSteps(dataWith({ clients: [client()] })).client).toBe(true);
    expect(buildGettingStartedSteps(dataWith({ projects: [project()] })).project).toBe(false);
    const complete = buildGettingStartedSteps(dataWith({ clients: [client()], projects: [project()] }));
    expect(complete.client).toBe(true);
    expect(complete.project).toBe(true);
  });
});
