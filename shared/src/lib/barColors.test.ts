import { describe, it, expect } from "vitest";
import { resolveBarColor, resolveProjectColor } from "./barColors";
import type { BarColorMaps } from "./barColors";
import type { Allocation, Client, Project, Resource, Activity } from "../types/entities";

function maps(
  over: { activities?: Activity[]; projects?: Project[]; clients?: Client[]; resources?: Resource[] } = {},
): BarColorMaps {
  return {
    activities: new Map((over.activities ?? []).map((t) => [t.id, t])),
    projects: new Map((over.projects ?? []).map((p) => [p.id, p])),
    clients: new Map((over.clients ?? []).map((c) => [c.id, c])),
    resources: new Map((over.resources ?? []).map((r) => [r.id, r])),
  };
}

const TS = "t";
const alloc = (resourceId: string, activityId: string, projectId?: string): Allocation => ({
  id: "a",
  accountId: "acct",
  createdAt: TS,
  updatedAt: TS,
  resourceId,
  activityId,
  ...(projectId ? { projectId } : {}),
  startDate: "2026-06-01",
  endDate: "2026-06-02",
  hoursPerDay: 0,
  status: "confirmed",
});
const project = (id: string, color: string): Project => ({
  id,
  accountId: "acct",
  createdAt: TS,
  updatedAt: TS,
  name: id,
  clientId: "c",
  color,
});
const activity = (id: string, projectId?: string): Activity => ({
  id,
  accountId: "acct",
  createdAt: TS,
  updatedAt: TS,
  name: id,
  kind: "project",
  ...(projectId === undefined ? {} : { projectId }),
});
const resource = (id: string, kind: Resource["kind"]): Resource => ({
  id,
  accountId: "acct",
  createdAt: TS,
  updatedAt: TS,
  kind,
  role: "R",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#123456",
});

describe("resolveBarColor", () => {
  it("colours a person's bar by its project", () => {
    const m = maps({
      activities: [activity("t", "p")],
      projects: [project("p", "#abcdef")],
      resources: [resource("r", "person")],
    });
    expect(resolveBarColor(alloc("r", "t"), m)).toBe("#abcdef");
  });

  it("forces an EXTERNAL bar to neutral grey, overriding the project colour", () => {
    // Same project as the person above, but the external short-circuit wins so an outsourced
    // bar never looks like one of our own (DECISIONS.md "external kind": single neutral colour).
    const m = maps({
      activities: [activity("t", "p")],
      projects: [project("p", "#abcdef")],
      resources: [resource("ext", "external")],
    });
    expect(resolveBarColor(alloc("ext", "t"), m)).toBe("#9ca3af");
  });

  it("always shows an internal activity bar in grey", () => {
    const internal: Activity = {
      id: "internal",
      accountId: "acct",
      createdAt: TS,
      updatedAt: TS,
      name: "Admin",
      kind: "internal",
    };
    const base = maps({ activities: [internal], resources: [resource("r", "person")] });
    expect(resolveBarColor(alloc("r", "internal"), base)).toBe("#9ca3af");
  });
});

describe("resolveBarColor project attribution", () => {
  it("always shows an Internal-owned project in grey while keeping its saved colour", () => {
    const internalClient: Client = {
      id: "c",
      accountId: "acct",
      createdAt: TS,
      updatedAt: TS,
      name: "Internal",
      color: "#2d75da",
      builtin: true,
    };
    const saved = project("p", "#abcdef");
    const base = maps({
      activities: [activity("t", "p")],
      projects: [saved],
      clients: [internalClient],
      resources: [resource("r", "person")],
    });
    expect(resolveBarColor(alloc("r", "t"), base)).toBe("#9ca3af");
    expect(resolveProjectColor(saved, internalClient)).toBe("#9ca3af");
    expect(saved.color).toBe("#abcdef");
  });

  it("does not treat a project-less all-projects activity as internal work", () => {
    const crossProject: Activity = {
      id: "cross",
      accountId: "acct",
      createdAt: TS,
      updatedAt: TS,
      name: "Design",
      kind: "repeatable",
    };
    const m = maps({ activities: [crossProject], resources: [resource("r", "person")] });
    expect(resolveBarColor(alloc("r", "cross"), m)).toBe("#123456");
  });

  it("colours an attributed repeatable allocation by its effective project", () => {
    const repeatable: Activity = {
      id: "repeatable",
      accountId: "acct",
      createdAt: TS,
      updatedAt: TS,
      name: "Design",
      kind: "repeatable",
    };
    const m = maps({
      activities: [repeatable],
      projects: [project("p", "#abcdef")],
      resources: [resource("r", "person")],
    });

    expect(resolveBarColor(alloc("r", "repeatable", "p"), m)).toBe("#abcdef");
  });
});

describe("resolveBarColor fallbacks", () => {
  it("falls back to the client's colour when its project has no colour of its own", () => {
    // project.color is "" (falsy), so `if (project?.color)` must skip past it to the
    // `if (client?.color)` branch rather than short-circuiting to the resource/neutral fallback.
    const client: Client = {
      id: "c",
      accountId: "acct",
      createdAt: TS,
      updatedAt: TS,
      name: "Ferris",
      color: "#112233",
    };
    const m = maps({
      activities: [activity("t", "p")],
      projects: [project("p", "")],
      clients: [client],
      resources: [resource("r", "person")],
    });
    expect(resolveBarColor(alloc("r", "t"), m)).toBe("#112233");
  });

  it("falls all the way through to neutral grey when nothing in the chain resolves", () => {
    // Empty maps: the activity/project/client/resource lookups all miss, so this exercises the
    // terminal `resource?.color ?? NEUTRAL_COLOR` fallback directly, not the external/internal
    // early returns above it.
    const m = maps();
    expect(resolveBarColor(alloc("missing-r", "missing-t"), m)).toBe("#9ca3af");
  });
});
