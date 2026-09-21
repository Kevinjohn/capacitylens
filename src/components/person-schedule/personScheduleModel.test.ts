import { describe, expect, it } from "vitest";
import { emptyAppData, type Activity } from "@capacitylens/shared/types/entities";
import { makeActivity, makeAllocation, makeClient, makeProject, makeResource, makeTimeOff } from "../../test/fixtures";
import { buildPersonSchedule } from "./personScheduleModel";

const resource = makeResource({ id: "r1", accountId: "a1", name: "Diana Prince", color: "#123456" });
const client = makeClient({ id: "c1", accountId: "a1", name: "Wayne Foundation", color: "#222222" });
const project = makeProject({ id: "p1", accountId: "a1", clientId: client.id, name: "Watchtower", color: "#abcdef" });
const activity = makeActivity({ id: "t1", accountId: "a1", projectId: project.id, name: "Research" });

function withoutProjectId(value: Activity): Activity {
  const copy = { ...value };
  delete copy.projectId;
  return copy;
}

function build(overrides: Partial<Parameters<typeof buildPersonSchedule>[0]> = {}) {
  return buildPersonSchedule({
    accountId: "a1",
    resource,
    data: {
      ...emptyAppData(),
      resources: [resource],
      clients: [client],
      projects: [project],
      activities: [activity],
    },
    window: { startDate: "2026-09-07", endDate: "2026-10-04" },
    schedulingMode: "hourly",
    internalColourMode: "grey",
    showTaskFieldInSchedule: true,
    canSeeTimeOffNotes: false,
    title: "Diana Prince's schedule",
    activityFallback: "Activity",
    ...overrides,
  });
}

describe("buildPersonSchedule inclusion and ordering", () => {
  it("includes inclusive overlaps, keeps separate occurrences, and sorts deterministically", () => {
    const allocations = [
      makeAllocation({ id: "outside-before", endDate: "2026-09-06" }),
      makeAllocation({ id: "end-boundary", startDate: "2026-10-04", endDate: "2026-10-05", status: "completed" }),
      makeAllocation({ id: "same-b", startDate: "2026-09-07", endDate: "2026-09-08", status: "tentative" }),
      makeAllocation({ id: "same-a", startDate: "2026-09-07", endDate: "2026-09-08" }),
      makeAllocation({ id: "start-boundary", startDate: "2026-09-05", endDate: "2026-09-07" }),
      makeAllocation({ id: "outside-after", startDate: "2026-10-05", endDate: "2026-10-06" }),
    ];
    const timeOff = [makeTimeOff({ id: "same-time-off", startDate: "2026-09-07", endDate: "2026-09-08" })];

    const complete = build({
      data: {
        ...emptyAppData(),
        resources: [resource],
        clients: [client],
        projects: [project],
        activities: [activity],
        allocations,
        timeOff,
      },
    });

    expect(complete.model.entries.map((entry) => entry.key)).toEqual([
      "allocation:start-boundary",
      "allocation:same-a",
      "allocation:same-b",
      "timeOff:same-time-off",
      "allocation:end-boundary",
    ]);
    expect(complete.model.entries[0]).toMatchObject({ startDate: "2026-09-05", endDate: "2026-09-07" });
    expect(complete.model.entries.at(-1)).toMatchObject({ status: "completed" });
  });
});

describe("buildPersonSchedule allocation projection", () => {
  it("projects attribution, colours, hourly load, notes, and the maximum linked-series end", () => {
    const repeatable = withoutProjectId(
      makeActivity({
        id: "repeatable",
        kind: "repeatable",
        name: "Workshop",
      }),
    );
    const selected = makeAllocation({
      id: "occurrence-1",
      activityId: repeatable.id,
      projectId: project.id,
      seriesId: "series-1",
      startDate: "2026-09-10",
      endDate: "2026-09-11",
      hoursPerDay: 4,
      note: "Bring prototypes",
      task: "Prototype review",
    });
    const laterOtherResource = makeAllocation({
      id: "occurrence-2",
      resourceId: "other-resource",
      activityId: repeatable.id,
      projectId: project.id,
      seriesId: "series-1",
      startDate: "2027-02-01",
      endDate: "2027-02-03",
    });
    const result = build({
      data: {
        ...emptyAppData(),
        resources: [resource],
        clients: [client],
        projects: [project],
        activities: [repeatable],
        allocations: [selected, laterOtherResource],
      },
    });

    expect(result.model.entries).toEqual([
      expect.objectContaining({
        key: "allocation:occurrence-1",
        activity: "Workshop",
        project: "Watchtower",
        client: "Wayne Foundation",
        color: "#abcdef",
        hoursPerDay: 4,
        seriesEnd: "2027-02-03",
        note: "Bring prototypes",
        task: "Prototype review",
      }),
    ]);
  });
});

describe("buildPersonSchedule task visibility", () => {
  it("omits task text when the workspace visibility setting is off", () => {
    const result = build({
      data: {
        ...emptyAppData(),
        resources: [resource],
        activities: [activity],
        allocations: [makeAllocation({ task: "Hidden task", startDate: "2026-09-10", endDate: "2026-09-10" })],
      },
      showTaskFieldInSchedule: false,
    });
    expect(result.model.entries[0]).not.toHaveProperty("task");
  });
});

describe("buildPersonSchedule hour visibility", () => {
  it.each(["days", "hourly"] as const)("shows hours in %s mode", (schedulingMode) => {
    const result = build({
      schedulingMode,
      data: {
        ...emptyAppData(),
        resources: [resource],
        activities: [activity],
        allocations: [makeAllocation({ startDate: "2026-09-10", endDate: "2026-09-10" })],
      },
    });
    expect(result.model.entries[0]).toMatchObject({ hoursPerDay: 8 });
  });

  it("omits hours in Blocks mode and for external resources", () => {
    const external = makeResource({ id: "r1", kind: "external", name: "Daily Planet" });
    const inBlocks = build({
      schedulingMode: "blocks",
      data: {
        ...emptyAppData(),
        resources: [resource],
        activities: [activity],
        allocations: [makeAllocation({ startDate: "2026-09-10", endDate: "2026-09-10" })],
      },
    });
    const externalResult = build({
      resource: external,
      data: {
        ...emptyAppData(),
        resources: [external],
        activities: [activity],
        allocations: [makeAllocation({ startDate: "2026-09-10", endDate: "2026-09-10" })],
      },
    });
    expect(inBlocks.model.entries[0]).not.toHaveProperty("hoursPerDay");
    expect(externalResult.model.entries[0]).not.toHaveProperty("hoursPerDay");
  });
});

describe("buildPersonSchedule time off and Internal work", () => {
  it("omits external time off and projects time-off notes only when authorized", () => {
    const timeOff = makeTimeOff({ startDate: "2026-09-09", endDate: "2026-09-10", note: "Private appointment" });
    const repeatedTimeOff = makeTimeOff({
      id: "to2",
      startDate: "2026-09-09",
      endDate: "2026-09-10",
      note: "Second occurrence",
    });
    const denied = build({ data: { ...emptyAppData(), resources: [resource], timeOff: [timeOff, repeatedTimeOff] } });
    const allowed = build({
      canSeeTimeOffNotes: true,
      data: { ...emptyAppData(), resources: [resource], timeOff: [timeOff] },
    });
    const external = makeResource({ id: "r1", kind: "external", name: "Daily Planet" });
    const externalResult = build({
      resource: external,
      canSeeTimeOffNotes: true,
      data: { ...emptyAppData(), resources: [external], timeOff: [timeOff] },
    });

    expect(denied.model.entries).toHaveLength(2);
    expect(denied.model.entries[0]).not.toHaveProperty("note");
    expect(allowed.model.entries[0]).toMatchObject({ kind: "timeOff", note: "Private appointment" });
    expect(externalResult.model.entries).toEqual([]);
  });

  it("uses the Internal colour preference without dropping internal work", () => {
    const internalClient = makeClient({ id: "internal", builtin: true, name: "Internal", color: "#112233" });
    const internalActivity = withoutProjectId(makeActivity({ kind: "internal", name: "Admin" }));
    const data = {
      ...emptyAppData(),
      resources: [resource],
      clients: [internalClient],
      activities: [internalActivity],
      allocations: [
        makeAllocation({ activityId: internalActivity.id, startDate: "2026-09-10", endDate: "2026-09-10" }),
      ],
    };

    expect(build({ data }).model.entries[0]).toMatchObject({ activity: "Admin", client: "Internal", color: "#9ca3af" });
    expect(build({ data, internalColourMode: "palette" }).model.entries[0]).toMatchObject({ color: "#123456" });
  });
});

describe("buildPersonSchedule defensive projection", () => {
  it("uses projected names untouched, falls back for missing activities, and returns invalid diagnostics", () => {
    const projectedClient = makeClient({ id: "c1", name: '"Foundation"' });
    const projectedProject = makeProject({ id: "p1", clientId: projectedClient.id, name: '"Tower"' });
    const invalid = makeAllocation({ id: "invalid", startDate: "not-a-date", endDate: "2026-09-10" });
    const missingActivity = makeAllocation({
      id: "missing",
      activityId: "missing",
      startDate: "2026-09-10",
      endDate: "2026-09-10",
    });
    const result = build({
      data: {
        ...emptyAppData(),
        resources: [resource],
        clients: [projectedClient],
        projects: [projectedProject],
        activities: [activity],
        allocations: [makeAllocation({ startDate: "2026-09-08", endDate: "2026-09-08" }), invalid, missingActivity],
      },
    });

    expect(result.model.entries[0]).toMatchObject({ project: '"Tower"', client: '"Foundation"' });
    expect(result.model.entries[1]).toMatchObject({ activity: "Activity" });
    expect(result.invalidRecords).toEqual([{ kind: "allocation", sourceId: "invalid" }]);
  });
});
