import { describe, expect, it } from "vitest";
import { NEUTRAL_COLOR } from "@capacitylens/shared/lib/color";
import { externalCapacityDefaults } from "@capacitylens/shared/types/entities";
import {
  account,
  activity,
  allocation,
  client,
  closure,
  freshApp,
  meta,
  person,
  project,
  timeOff,
} from "./fixtures/appTestEntities";
import { patch, post } from "./fixtures/appTestHttp";
import { readValidatedState } from "./fixtures/appTestSnapshotBatch";
import { scaffold } from "./fixtures/appTestScaffold";

type Case = { table: string; field: string; invalid: unknown; valid: Record<string, unknown> };
const nonPreset = "#123456";
const longName = "N".repeat(101);
const longNote = "n".repeat(1001);
const validDate = "2026-02-01";
const invalidDate = "2026-02-30";
const cases: Case[] = [
  { table: "accounts", field: "name", invalid: longName, valid: account("a1") },
  { table: "accounts", field: "color", invalid: nonPreset, valid: account("a1") },
  ...[
    ["schedulingMode", "yearly"],
    ["capacityOverviewAccess", "anyone"],
    ["dateStyle", "unknown"],
    ["language", "cy"],
    ["disciplinesEnabled", "yes"],
    ["placeholdersEnabled", 1],
    ["externalEnabled", null],
    ["inlineActivityCreateEnabled", "false"],
    ["showTaskFieldInSchedule", 0],
    ["workingDays", [1, 1]],
    ["weekStartsOn", 3],
    ["timezone", "Mars/Olympus"],
  ].map(([field, invalid]) => ({ table: "accounts", field: String(field), invalid, valid: account("a1") })),
  ...[
    ["name", longName],
    ["color", nonPreset],
    ["isPrivate", "yes"],
    ["codeName", longName],
  ].map(([field, invalid]) => ({ table: "clients", field: String(field), invalid, valid: client("bad", "a1") })),
  ...[
    ["name", longName],
    ["color", nonPreset],
    ["isPrivate", 1],
    ["codeName", longName],
    ["clientId", "another-account-client"],
  ].map(([field, invalid]) => ({
    table: "projects",
    field: String(field),
    invalid,
    valid: project("bad", "a1", "c1"),
  })),
  ...[
    ["name", longName],
    ["color", nonPreset],
    ["sortOrder", 1.5],
  ].map(([field, invalid]) => ({
    table: "disciplines",
    field: String(field),
    invalid,
    valid: { id: "bad", accountId: "a1", name: "Design", color: "#5c34d4", sortOrder: 0, ...meta() },
  })),
  ...[
    ["name", longName],
    ["projectId", "another-account-project"],
  ].map(([field, invalid]) => ({
    table: "phases",
    field: String(field),
    invalid,
    valid: { id: "bad", accountId: "a1", name: "Build", projectId: "p1", ...meta() },
  })),
  ...[
    ["name", longName],
    ["kind", "other"],
    ["projectId", "another-account-project"],
    ["phaseId", "another-account-phase"],
  ].map(([field, invalid]) => ({
    table: "activities",
    field: String(field),
    invalid,
    valid: activity({ id: "bad", accountId: "a1", projectId: "p1" }),
  })),
  ...[
    ["kind", "other"],
    ["name", longName],
    ["role", longName],
    ["employmentType", "other"],
    ["engagement", "other"],
    ["workingHoursPerDay", 25],
    ["workingDays", [7]],
    ["halfDays", [0]],
    ["color", nonPreset],
    ["isFavourite", "true"],
    ["firstAvailableDate", invalidDate],
    ["lastAvailableDate", invalidDate],
    ["avatarUrl", "http://images.example/avatar.png"],
    ["disciplineId", "another-account-discipline"],
  ].map(([field, invalid]) => ({ table: "resources", field: String(field), invalid, valid: person("bad", "a1") })),
  ...[
    ["resourceId", "another-account-resource"],
    ["activityId", "another-account-activity"],
    ["startDate", invalidDate],
    ["endDate", invalidDate],
    ["hoursPerDay", 25],
    ["status", "maybe"],
    ["note", longNote],
    ["task", longName],
    ["ignoreWeekends", 1],
    ["projectId", "another-account-project"],
  ].map(([field, invalid]) => ({
    table: "allocations",
    field: String(field),
    invalid,
    valid: allocation({ id: "bad", accountId: "a1", resourceId: "r1", activityId: "t1" }),
  })),
  ...[
    ["resourceId", "another-account-resource"],
    ["startDate", invalidDate],
    ["endDate", invalidDate],
    ["type", "unsupported"],
    ["note", longNote],
  ].map(([field, invalid]) => ({
    table: "timeOff",
    field: String(field),
    invalid,
    valid: timeOff({ id: "bad", accountId: "a1", resourceId: "r1" }),
  })),
  ...[
    ["name", longName],
    ["startDate", invalidDate],
    ["endDate", invalidDate],
  ].map(([field, invalid]) => ({
    table: "closures",
    field: String(field),
    invalid,
    valid: closure("bad", "a1"),
  })),
];

// eslint-disable-next-line max-lines-per-function -- the cases share one HTTP fixture and atomicity assertion.
describe("ordinary-write field contract matrix", () => {
  it("rejects malformed supplied values at the HTTP boundary without persisting any row", async () => {
    for (const { table, field, invalid, valid } of cases) {
      const { app } = freshApp();
      if (table !== "accounts") await scaffold(app);
      const before = await readValidatedState(app);
      const response = await post(app, table, { ...valid, [field]: invalid });
      expect(response.statusCode, `${table}.${field}`).toBe(400);
      expect(await readValidatedState(app), `${table}.${field} leaves the state unchanged`).toEqual(before);
      await app.close();
    }
  });

  it("requires person and external company names without inventing import placeholders", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const before = await readValidatedState(app);
    const unnamed: Record<string, unknown> = { ...person("unnamed", "a1") };
    delete unnamed.name;
    expect((await post(app, "resources", unnamed)).statusCode).toBe(400);
    const external = { ...unnamed, kind: "external", ...externalCapacityDefaults(), color: NEUTRAL_COLOR };
    expect((await post(app, "resources", external)).statusCode).toBe(400);
    expect(await readValidatedState(app)).toEqual(before);
    expect((await post(app, "resources", { ...external, name: "Queen Consolidated" })).statusCode).toBe(201);
    await app.close();
  });

  it("preserves valid opaque allocation IDs beyond the text-name limit", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const projectId = "p".repeat(101);
    const seriesId = "s".repeat(256);
    expect((await post(app, "projects", project(projectId, "a1", "c1"))).statusCode).toBe(201);
    expect((await readValidatedState(app)).projects.find((item) => item.id === projectId)).toBeDefined();
    expect(
      (
        await post(app, "activities", {
          ...activity({ id: "repeatable", accountId: "a1", projectId: "p1" }),
          kind: "repeatable",
          projectId: undefined,
        })
      ).statusCode,
    ).toBe(201);
    const row = {
      ...allocation({ id: "exact-ids", accountId: "a1", resourceId: "r1", activityId: "repeatable" }),
      projectId,
      seriesId,
    };
    const created = await post(app, "allocations", row);
    expect(created.statusCode, created.body).toBe(201);
    expect((await readValidatedState(app)).allocations.find((item) => item.id === "exact-ids")).toMatchObject({
      projectId,
      seriesId,
    });
    expect(
      (await patch({ app, entity: "allocations", id: "exact-ids", payload: { seriesId, projectId, note: "Edited" } }))
        .statusCode,
    ).toBe(200);
    expect((await readValidatedState(app)).allocations.find((item) => item.id === "exact-ids")).toMatchObject({
      projectId,
      seriesId,
      note: "Edited",
    });
    expect((await post(app, "allocations", { ...row, id: "too-long", seriesId: "s".repeat(257) })).statusCode).toBe(
      400,
    );
    await app.close();
  });

  it("accepts each boundary's valid fixture and calendar date", async () => {
    for (const table of new Set(cases.map((entry) => entry.table))) {
      const { app } = freshApp();
      if (table !== "accounts") await scaffold(app);
      const valid = cases.find((entry) => entry.table === table)?.valid;
      expect(valid).toBeDefined();
      const response = await post(app, table, {
        ...valid,
        ...(table === "resources" ? { firstAvailableDate: validDate } : {}),
      });
      expect(response.statusCode, table).toBe(201);
      await app.close();
    }
  });

  it("keeps the URL row authoritative when a PATCH echoes a different body ID", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const response = await patch({
      app,
      entity: "clients",
      id: "c1",
      payload: { id: "other-row", name: "Wayne Enterprises" },
    });
    expect(response.statusCode).toBe(200);
    const clients = (await readValidatedState(app)).clients;
    expect(clients.find((item) => item.id === "c1")?.name).toBe("Wayne Enterprises");
    expect(clients.find((item) => item.id === "other-row")).toBeUndefined();
    await app.close();
  });
});
