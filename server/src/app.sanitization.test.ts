import { describe, expect, it } from "vitest";
import { account, allocation, freshApp, person } from "./fixtures/appTestEntities";
import { batch, patch, post, put } from "./fixtures/appTestHttp";
import { readValidatedState } from "./fixtures/appTestSnapshotBatch";
import { scaffold } from "./fixtures/appTestScaffold";

const current = async (app: ReturnType<typeof freshApp>["app"]) => readValidatedState(app);

describe("strict ordinary writes", () => {
  it("rejects non-preset colour instead of changing it, while preserving a valid preset", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", { ...account("a1"), color: "#7cd9e4" })).statusCode).toBe(400);
    expect((await current(app)).accounts).toEqual([]);
    expect((await post(app, "accounts", { id: "a1", color: "#5c34d4" })).statusCode).toBe(400);
    expect((await post(app, "accounts", account("a1"))).statusCode).toBe(201);
    expect((await current(app)).accounts[0]?.color).toBe("#5c34d4");
  });

  it("rejects forged choices, wrong types, unknown fields and out-of-range numbers without creating a resource", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const valid = person("r1", "a1");
    for (const change of [
      { kind: "wizard" },
      { employmentType: "overlord" },
      { workingHoursPerDay: -5 },
      { workingDays: "nope" },
      { workingDays: [1, 1] },
      { isFavourite: "yes" },
      { name: 42 },
      { name: "x".repeat(101) },
      { unknownField: "value" },
      { isFavourite: null },
      { employmentType: null },
    ]) {
      expect((await post(app, "resources", { ...valid, ...change })).statusCode).toBe(400);
      expect((await current(app)).resources).toEqual([]);
    }
    expect((await post(app, "resources", valid)).statusCode).toBe(201);
  });
});

describe("strict ordinary updates", () => {
  it("rejects invalid PUT and PATCH values without changing the allocation", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const valid = allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t1" });
    expect((await post(app, "allocations", valid)).statusCode).toBe(201);
    const before = (await current(app)).allocations;
    expect(
      (await put({ app, entity: "allocations", id: "al1", payload: { ...valid, status: "maybe" } })).statusCode,
    ).toBe(400);
    expect((await patch({ app, entity: "allocations", id: "al1", payload: { hoursPerDay: -3 } })).statusCode).toBe(400);
    expect((await current(app)).allocations).toEqual(before);
  });

  it("rejects a bad account choice or weekday set while preserving the stored settings", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", account("a1"))).statusCode).toBe(201);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { workingDays: [1, 3, 5] } })).statusCode).toBe(
      200,
    );
    const before = (await current(app)).accounts;
    for (const bad of [
      { schedulingMode: "wizard" },
      { workingDays: [1, 9] },
      { workingDays: [] },
      { externalEnabled: "false" },
      { externalEnabled: null },
      { schedulingMode: null },
      { capacityOverviewAccess: "anyone" },
    ]) {
      expect((await patch({ app, entity: "accounts", id: "a1", payload: bad })).statusCode).toBe(400);
      expect((await current(app)).accounts).toEqual(before);
    }
    expect((await put({ app, entity: "accounts", id: "a1", payload: account("a1") })).statusCode).toBe(200);
    expect((await current(app)).accounts[0]?.workingDays).toEqual([1, 3, 5]);
  });
});

describe("strict ordinary write integrity", () => {
  it("rejects malformed or reversed availability without removing existing limits", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const original = person("r1", "a1");
    expect(
      (
        await patch({
          app,
          entity: "resources",
          id: "r1",
          payload: {
            firstAvailableDate: "2026-02-01",
            lastAvailableDate: "2026-02-28",
          },
        })
      ).statusCode,
    ).toBe(200);
    const before = (await current(app)).resources.find((row) => row.id === "r1");
    for (const patchValue of [
      { firstAvailableDate: "not-a-date" },
      { firstAvailableDate: "2026-02-30" },
      { lastAvailableDate: 42 },
      { lastAvailableDate: "2026-01-01" },
    ]) {
      expect(
        (await patch({ app, entity: "resources", id: "r1", payload: { ...patchValue, role: "Editor" } })).statusCode,
      ).toBe(400);
      expect((await current(app)).resources.find((row) => row.id === "r1")).toEqual(before);
    }
    expect(
      (
        await put({
          app,
          entity: "resources",
          id: "r1",
          payload: {
            ...original,
            firstAvailableDate: "2026-02-01",
            lastAvailableDate: "2026-01-01",
          },
        })
      ).statusCode,
    ).toBe(400);
    expect((await current(app)).resources.find((row) => row.id === "r1")).toEqual(before);
    expect(
      (await patch({ app, entity: "resources", id: "r1", payload: { firstAvailableDate: null } })).statusCode,
    ).toBe(200);
    const afterFirst = (await current(app)).resources.find((row) => row.id === "r1");
    expect(afterFirst?.firstAvailableDate).toBeUndefined();
    expect(afterFirst?.lastAvailableDate).toBe("2026-02-28");
    expect((await patch({ app, entity: "resources", id: "r1", payload: { lastAvailableDate: null } })).statusCode).toBe(
      200,
    );
    expect((await current(app)).resources.find((row) => row.id === "r1")?.lastAvailableDate).toBeUndefined();
  });
});

describe("strict batch and text writes", () => {
  it("rejects one invalid batch operation atomically", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const before = await current(app);
    const valid = allocation({ id: "al-good", accountId: "a1", resourceId: "r1", activityId: "t1" });
    const invalid = allocation({
      id: "al-bad",
      accountId: "a1",
      resourceId: "r1",
      activityId: "t1",
      o: { status: "maybe" },
    });
    expect(
      (
        await batch(app, [
          { method: "PUT", table: "allocations", id: "al-good", row: valid },
          { method: "PUT", table: "allocations", id: "al-bad", row: invalid },
        ])
      ).statusCode,
    ).toBe(400);
    expect(await current(app)).toEqual(before);
  });

  it("normalizes accepted composed text and whitespace without stripping punctuation", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect(
      (
        await post(app, "clients", {
          id: "c1",
          accountId: "a1",
          name: `  ${"e\u0301".repeat(60)}   O'Brien  `,
          color: "#5c34d4",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        })
      ).statusCode,
    ).toBe(201);
    expect((await current(app)).clients.find((row) => row.id === "c1")?.name).toBe(`${"é".repeat(60)} O'Brien`);
  });
});

describe("untrusted JSON request parsing", () => {
  it("rejects duplicate keys, excess depth, unsafe numbers and malformed UTF-8 before a write", async () => {
    const { app } = freshApp();
    const requests: Array<string | Buffer> = [
      '{"id":"a1","name":"Wayne Enterprises","name":"Stark Industries"}',
      `${"[".repeat(65)}0${"]".repeat(65)}`,
      '{"number":9007199254740992}',
      Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]),
    ];
    for (const payload of requests) {
      const response = await app.inject({
        method: "POST",
        url: "/api/accounts",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    for (const mediaType of ["application/csp-report", "application/reports+json"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/accounts",
        headers: { "content-type": mediaType },
        payload: '{"id":"a1","name":"Studio","name":"Changed"}',
      });
      expect(response.statusCode).toBe(415);
    }
    expect((await current(app)).accounts).toEqual([]);
  });
});
