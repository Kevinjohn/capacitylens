import { describe, it, expect } from "vitest";
import { freshApp, client, allocation } from "./fixtures/appTestEntities";
import { call, readErrorResponse, body, post, patch, batch, orderedBatch, state } from "./fixtures/appTestHttp";
import { scaffold } from "./fixtures/appTestScaffold";

function createDirectAvailabilityBoundaryTests(): void {
  it.each([
    {
      direction: "before",
      boundary: { firstAvailableDate: "2026-06-08" },
      date: "2026-06-01",
      code: "allocation_before_resource_availability",
    },
    {
      direction: "after",
      boundary: { lastAvailableDate: "2026-06-03" },
      date: "2026-06-08",
      code: "allocation_after_resource_availability",
    },
  ] as const)("rejects a direct allocation $direction the person's boundary", async ({ boundary, date, code }) => {
    const { app } = freshApp();
    await scaffold(app);
    expect((await patch({ app, entity: "resources", id: "r1", payload: boundary })).statusCode).toBe(200);

    const response = await post(
      app,
      "allocations",
      allocation({
        id: "outside",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: { startDate: date, endDate: date },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code });
  });
}

function createAvailabilityCalendarProjectionTest(): void {
  it("uses the stored company calendar through the database projection", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await patch({ app, entity: "accounts", id: "a1", payload: { workingDays: [1, 2, 3, 4] } });
    await patch({ app, entity: "resources", id: "r1", payload: { lastAvailableDate: "2026-06-04" } });

    const normal = await post(
      app,
      "allocations",
      allocation({
        id: "normal",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: { startDate: "2026-06-04", endDate: "2026-06-05" },
      }),
    );
    const ignored = await post(
      app,
      "allocations",
      allocation({
        id: "ignored",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: { startDate: "2026-06-04", endDate: "2026-06-05", ignoreWeekends: true },
      }),
    );

    expect(normal.statusCode).toBe(201);
    expect(ignored.statusCode).toBe(400);
    expect(ignored.json()).toMatchObject({ code: "allocation_after_resource_availability" });
  });
}

function createRetainedAvailabilityConflictTest(): void {
  it("allows metadata edits on a retained conflict through the authoritative API", async () => {
    const { app } = freshApp();
    await scaffold(app);
    expect(
      (
        await post(
          app,
          "allocations",
          allocation({ id: "retained", accountId: "a1", resourceId: "r1", activityId: "t1" }),
        )
      ).statusCode,
    ).toBe(201);
    await patch({ app, entity: "resources", id: "r1", payload: { firstAvailableDate: "2026-06-08" } });

    const response = await patch({ app, entity: "allocations", id: "retained", payload: { note: "Keep context" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ note: "Keep context", startDate: "2026-01-01" });
  });
}

function createAvailabilityBatchRollbackTest(): void {
  it.each([
    {
      boundary: { firstAvailableDate: "2026-06-01" },
      outsideDate: "2026-05-29",
      code: "allocation_before_resource_availability",
    },
    {
      boundary: { lastAvailableDate: "2026-06-01" },
      outsideDate: "2026-06-08",
      code: "allocation_after_resource_availability",
    },
  ] as const)("rolls back an atomic batch for $code", async ({ boundary, outsideDate, code }) => {
    const { app } = freshApp();
    await scaffold(app);
    await patch({ app, entity: "resources", id: "r1", payload: boundary });
    const inside = allocation({
      id: "inside",
      accountId: "a1",
      resourceId: "r1",
      activityId: "t1",
      o: { startDate: "2026-06-01", endDate: "2026-06-01" },
    });
    const outside = allocation({
      id: "outside",
      accountId: "a1",
      resourceId: "r1",
      activityId: "t1",
      o: { startDate: outsideDate, endDate: outsideDate },
    });

    const response = await batch(app, [
      { method: "PUT", table: "allocations", id: "inside", row: inside },
      { method: "PUT", table: "allocations", id: "outside", row: outside },
    ]);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code });
    expect((await state(app)).allocations).toHaveLength(0);
  });
}

describe("resource availability API enforcement", () => {
  createDirectAvailabilityBoundaryTests();
  createAvailabilityCalendarProjectionTest();
  createRetainedAvailabilityConflictTest();
  createAvailabilityBatchRollbackTest();
});

describe("batch pre-scan validation", () => {
  it.each([
    [{ "x-capacitylens-sync-session": "short", "x-capacitylens-sync-sequence": "1" }],
    [{ "x-capacitylens-sync-session": "browser-session-valid-0001", "x-capacitylens-sync-sequence": "0" }],
    [{ "x-capacitylens-sync-session": "browser-session-valid-0001" }],
  ])("rejects malformed browser ordering headers %#", async (headers) => {
    const { app } = freshApp();
    const response = await call(app, {
      method: "POST",
      url: "/api/batch",
      headers,
      payload: body({ ops: [] }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid browser sync ordering headers." });
  });

  it.each([
    ["PUT", { method: "PUT", table: "clients", id: "c1", row: { ...client("c1", "a1"), updatedAt: 1 } }],
    ["DELETE", { method: "DELETE", table: "disciplines", id: "d1", accountId: "a1", updatedAt: null }],
    ["ARCHIVE", { method: "ARCHIVE", table: "clients", id: "c1", accountId: "a1", updatedAt: false }],
  ])("requires a string updatedAt for ordered %s operations", async (verb, op) => {
    const { app } = freshApp();
    const response = await orderedBatch({ app, sessionId: "browser-session-valid-0002", sequence: 1, ops: [op] });
    expect(response.statusCode).toBe(400);
    expect(readErrorResponse(response).error).toContain(`ordered ${verb} op needs a string updatedAt`);
  });

  it.each([
    ["unknown method", { method: "PATCH", table: "clients", id: "c1" }, /Unknown op method/],
    ["DELETE account", { method: "DELETE", table: "disciplines", id: "d1", accountId: 1 }, /string accountId/],
    [
      "ARCHIVE non-lifecycle",
      { method: "ARCHIVE", table: "disciplines", id: "d1", accountId: "a1" },
      /only for lifecycle/,
    ],
    ["ARCHIVE account", { method: "ARCHIVE", table: "clients", id: "c1" }, /string accountId/],
  ])("rejects an invalid $name during pre-scan", async (_name, op, message) => {
    const { app } = freshApp();
    const response = await batch(app, [op]);
    expect(response.statusCode).toBe(400);
    expect(readErrorResponse(response).error).toMatch(message);
  });
});
