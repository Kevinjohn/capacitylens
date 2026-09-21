import { describe, it, expect } from "vitest";
import {
  freshApp,
  account,
  client,
  project,
  activity,
  person,
  placeholder,
  allocation,
} from "./fixtures/appTestEntities";
import { post, put, patch, batch, orderedBatch } from "./fixtures/appTestHttp";
import { readActivity, readAllocation } from "./fixtures/appTestSnapshotSchedule";
import { readResource } from "./fixtures/appTestSnapshotAccount";
import { readBatchReceipt, readActivityWriteResponse, readValidatedState } from "./fixtures/appTestSnapshotBatch";
import { readStateAllocation } from "./fixtures/appTestScaffold";

const seedAttributedActivity = async (resourceKind: "person" | "placeholder" = "person") => {
  const fixture = freshApp();
  await post(fixture.app, "accounts", account("a1"));
  await post(fixture.app, "clients", client("c1", "a1"));
  await post(fixture.app, "projects", project("p1", "a1", "c1"));
  if (resourceKind === "placeholder") {
    await post(fixture.app, "projects", project("p2", "a1", "c1"));
  }
  const resource = resourceKind === "placeholder" ? placeholder("ph", "a1", "p1") : person("r1", "a1");
  await post(fixture.app, "resources", resource);
  await post(fixture.app, "activities", {
    ...activity({ id: "repeatable", accountId: "a1", projectId: "p1" }),
    kind: "repeatable",
    projectId: undefined,
  });
  await post(
    fixture.app,
    "allocations",
    allocation({
      id: "allocation",
      accountId: "a1",
      resourceId: resource.id,
      activityId: "repeatable",
      o: { projectId: "p1" },
    }),
  );
  return fixture;
};

const reconcileAllocationFirst = async (fixture: Awaited<ReturnType<typeof seedAttributedActivity>>) => {
  const before = await readValidatedState(fixture.app);
  const currentActivity = readActivity(before.activities, "repeatable");
  const currentAllocation = readAllocation(before.allocations, "allocation");
  expect(currentActivity.id).toBe("repeatable");
  expect(currentAllocation.id).toBe("allocation");
  const response = await orderedBatch({
    app: fixture.app,
    sessionId: "browser-session-kind-change-0001",
    sequence: 1,
    ops: [
      { method: "PUT", table: "allocations", id: "allocation", row: currentAllocation },
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "project", projectId: "p1" },
      },
    ],
  });
  expect(response.statusCode).toBe(200);
  const state = await readValidatedState(fixture.app);
  const rewrittenAllocation = readAllocation(state.allocations, "allocation");
  expect(rewrittenAllocation).not.toHaveProperty("projectId");
  expect(readBatchReceipt(response).revisions).toContainEqual({
    table: "allocations",
    id: "allocation",
    createdAt: rewrittenAllocation.createdAt,
    updatedAt: rewrittenAllocation.updatedAt,
    rewrite: true,
  });
};

const reconcileExplicitClearedAllocation = async (fixture: Awaited<ReturnType<typeof seedAttributedActivity>>) => {
  const before = await readValidatedState(fixture.app);
  const currentActivity = readActivity(before.activities, "repeatable");
  const currentAllocation = readAllocation(before.allocations, "allocation");
  const clearedAllocation = { ...currentAllocation };
  delete clearedAllocation.projectId;
  const response = await orderedBatch({
    app: fixture.app,
    sessionId: "browser-session-kind-change-0002",
    sequence: 1,
    ops: [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "project", projectId: "p1" },
      },
      { method: "PUT", table: "allocations", id: "allocation", row: clearedAllocation },
    ],
  });
  expect(response.statusCode).toBe(200);
  expect(await readStateAllocation(fixture.app, "allocation")).not.toHaveProperty("projectId");
};

const reconcileImplicitRewrite = async (fixture: Awaited<ReturnType<typeof seedAttributedActivity>>) => {
  const before = await readValidatedState(fixture.app);
  const currentActivity = readActivity(before.activities, "repeatable");
  const response = await orderedBatch({
    app: fixture.app,
    sessionId: "browser-session-kind-change-0003",
    sequence: 1,
    ops: [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "project", projectId: "p1" },
      },
    ],
  });
  expect(response.statusCode).toBe(200);
  const currentAllocation = await readStateAllocation(fixture.app, "allocation");
  expect(currentAllocation).not.toHaveProperty("projectId");
  expect(readBatchReceipt(response).revisions).toContainEqual({
    table: "allocations",
    id: "allocation",
    createdAt: currentAllocation.createdAt,
    updatedAt: currentAllocation.updatedAt,
    rewrite: true,
  });
};

const rejectForbiddenAllocation = async (fixture: Awaited<ReturnType<typeof seedAttributedActivity>>) => {
  const before = await readValidatedState(fixture.app);
  const currentActivity = readActivity(before.activities, "repeatable");
  const currentAllocation = readAllocation(before.allocations, "allocation");
  const response = await orderedBatch({
    app: fixture.app,
    sessionId: "browser-session-kind-change-0004",
    sequence: 1,
    ops: [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "project", projectId: "p1" },
      },
      { method: "PUT", table: "allocations", id: "allocation", row: currentAllocation },
    ],
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ code: "allocation_project_forbidden" });
  expect(readActivity((await readValidatedState(fixture.app)).activities, "repeatable")).toMatchObject({
    kind: "repeatable",
  });
};

function createAttributedAllocationReconciliationTest() {
  it("reconciles attributed allocations after repeatable activity kind changes", async () => {
    const allocationFirst = await seedAttributedActivity();
    await reconcileAllocationFirst(allocationFirst);

    const explicit = await seedAttributedActivity();
    await reconcileExplicitClearedAllocation(explicit);

    const implicit = await seedAttributedActivity();
    await reconcileImplicitRewrite(implicit);

    const forbidden = await seedAttributedActivity();
    await rejectForbiddenAllocation(forbidden);
  });
}

function createAtFlipTimeClearingTest() {
  it("keeps at-flip-time clearing after an activity flips back before a dependent write", async () => {
    const fixture = await seedAttributedActivity("placeholder");
    const before = await readValidatedState(fixture.app);
    const currentActivity = readActivity(before.activities, "repeatable");

    const response = await batch(fixture.app, [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "internal", projectId: undefined },
      },
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "repeatable", projectId: undefined },
      },
      {
        method: "PUT",
        table: "resources",
        id: "ph",
        row: { ...readResource(before.resources, "ph"), projectId: "p2" },
      },
    ]);

    expect(response.statusCode, response.body).toBe(200);
    const rewritten = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(rewritten).not.toHaveProperty("projectId");
    expect(readBatchReceipt(response).revisions).toContainEqual({
      table: "allocations",
      id: rewritten.id,
      createdAt: rewritten.createdAt,
      updatedAt: rewritten.updatedAt,
      rewrite: true,
    });
  });
}

function createCorruptAttributionValidationTest() {
  it("validates an activity edit against corrupt attribution before clearing it", async () => {
    const fixture = await seedAttributedActivity("placeholder");
    fixture.db.prepare("UPDATE resources SET projectId = 'p2' WHERE id = 'ph'").run();
    const before = await readValidatedState(fixture.app);

    const response = await batch(fixture.app, [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...readActivity(before.activities, "repeatable"), kind: "project", projectId: "p1" },
      },
    ]);

    expect(response.statusCode).toBe(200);
    expect(await readStateAllocation(fixture.app, "allocation")).not.toHaveProperty("projectId");
  });
}

function createDirectActivityPutClearingTest() {
  it("keeps direct activity PUT attribution clearing behavior", async () => {
    const fixture = await seedAttributedActivity();
    const before = await readValidatedState(fixture.app);
    const allocationBefore = readAllocation(before.allocations, "allocation");

    const response = await put({
      app: fixture.app,
      entity: "activities",
      id: "repeatable",
      payload: {
        ...readActivity(before.activities, "repeatable"),
        kind: "internal",
        projectId: undefined,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(readActivityWriteResponse(response)).toMatchObject({ id: "repeatable", kind: "internal" });
    expect(readActivityWriteResponse(response)).not.toHaveProperty("table");
    const allocationAfter = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(allocationAfter).not.toHaveProperty("projectId");
    expect(Date.parse(allocationAfter.updatedAt)).toBeGreaterThan(Date.parse(allocationBefore.updatedAt));
    expect(readActivityWriteResponse(response).rewrittenAllocations).toEqual([
      { id: allocationAfter.id, createdAt: allocationAfter.createdAt, updatedAt: allocationAfter.updatedAt },
    ]);
  });
}

function createDirectActivityPatchClearingTest() {
  it("keeps direct activity PATCH attribution clearing behavior", async () => {
    const fixture = await seedAttributedActivity();
    const allocationBefore = await readStateAllocation(fixture.app, "allocation");

    const response = await patch({
      app: fixture.app,
      entity: "activities",
      id: "repeatable",
      payload: {
        kind: "internal",
        projectId: undefined,
      },
    });

    expect(response.statusCode).toBe(200);
    const allocationAfter = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(allocationAfter).not.toHaveProperty("projectId");
    expect(Date.parse(allocationAfter.updatedAt)).toBeGreaterThan(Date.parse(allocationBefore.updatedAt));
    expect(readActivityWriteResponse(response).rewrittenAllocations).toEqual([
      { id: allocationAfter.id, createdAt: allocationAfter.createdAt, updatedAt: allocationAfter.updatedAt },
    ]);
  });
}

function createLegacyAttributionRepairTest() {
  it("repairs legacy attribution when a batch re-PUTs an already ineligible activity", async () => {
    const fixture = freshApp();
    await post(fixture.app, "accounts", account("a1"));
    await post(fixture.app, "clients", client("c1", "a1"));
    await post(fixture.app, "projects", project("p1", "a1", "c1"));
    await post(fixture.app, "resources", person("r1", "a1"));
    await post(fixture.app, "activities", {
      ...activity({ id: "internal", accountId: "a1", projectId: "p1" }),
      kind: "internal",
      projectId: undefined,
    });
    await post(fixture.app, "activities", {
      ...activity({ id: "repeatable", accountId: "a1", projectId: "p1" }),
      kind: "repeatable",
      projectId: undefined,
    });
    await post(
      fixture.app,
      "allocations",
      allocation({
        id: "allocation",
        accountId: "a1",
        resourceId: "r1",
        activityId: "repeatable",
        o: { projectId: "p1" },
      }),
    );
    fixture.db.prepare("UPDATE allocations SET activityId = 'internal' WHERE id = 'allocation'").run();
    const current = readActivity((await readValidatedState(fixture.app)).activities, "internal");

    const response = await batch(fixture.app, [{ method: "PUT", table: "activities", id: "internal", row: current }]);

    expect(response.statusCode).toBe(200);
    const repaired = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(repaired).not.toHaveProperty("projectId");
    expect(readBatchReceipt(response).revisions).toContainEqual({
      table: "allocations",
      id: repaired.id,
      createdAt: repaired.createdAt,
      updatedAt: repaired.updatedAt,
      rewrite: true,
    });
  });
}

function createCoalescedKindFlipValidationTest() {
  it("keeps projection validation consistent for a coalesced activity kind flip and placeholder rebind", async () => {
    const fixture = freshApp();
    await post(fixture.app, "accounts", account("a1"));
    await post(fixture.app, "clients", client("c1", "a1"));
    await post(fixture.app, "projects", project("p1", "a1", "c1"));
    await post(fixture.app, "projects", project("p2", "a1", "c1"));
    await post(fixture.app, "resources", placeholder("ph", "a1", "p1"));
    await post(fixture.app, "activities", {
      ...activity({ id: "repeatable", accountId: "a1", projectId: "p1" }),
      kind: "repeatable",
      projectId: undefined,
    });
    await post(
      fixture.app,
      "allocations",
      allocation({
        id: "allocation",
        accountId: "a1",
        resourceId: "ph",
        activityId: "repeatable",
        o: { projectId: "p1" },
      }),
    );
    const before = await readValidatedState(fixture.app);

    const response = await batch(fixture.app, [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...readActivity(before.activities, "repeatable"), kind: "internal", projectId: undefined },
      },
      {
        method: "PUT",
        table: "resources",
        id: "ph",
        row: { ...readResource(before.resources, "ph"), projectId: "p2" },
      },
    ]);

    expect(response.statusCode).toBe(200);
    expect(await readStateAllocation(fixture.app, "allocation")).not.toHaveProperty("projectId");
  });
}

function createClearingBeforeArchiveTest() {
  it("clears and echoes allocation attribution before a later lifecycle archive in the same batch", async () => {
    const fixture = freshApp();
    await post(fixture.app, "accounts", account("a1"));
    await post(fixture.app, "clients", client("c1", "a1"));
    await post(fixture.app, "projects", project("p1", "a1", "c1"));
    await post(fixture.app, "resources", person("r1", "a1"));
    await post(fixture.app, "activities", {
      ...activity({ id: "repeatable", accountId: "a1", projectId: "p1" }),
      kind: "repeatable",
      projectId: undefined,
    });
    await post(
      fixture.app,
      "allocations",
      allocation({
        id: "allocation",
        accountId: "a1",
        resourceId: "r1",
        activityId: "repeatable",
        o: { projectId: "p1" },
      }),
    );
    const before = await readValidatedState(fixture.app);

    const response = await batch(fixture.app, [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...readActivity(before.activities, "repeatable"), kind: "internal", projectId: undefined },
      },
      { method: "ARCHIVE", table: "projects", id: "p1", accountId: "a1" },
    ]);

    expect(response.statusCode).toBe(200);
    const rewritten = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(rewritten).not.toHaveProperty("projectId");
    expect(readBatchReceipt(response).revisions).toContainEqual({
      table: "allocations",
      id: rewritten.id,
      createdAt: rewritten.createdAt,
      updatedAt: rewritten.updatedAt,
      rewrite: true,
    });
  });
}

describe("batch sync (/api/batch — transactional, ordered)", () => {
  createAttributedAllocationReconciliationTest();
  createAtFlipTimeClearingTest();
  createCorruptAttributionValidationTest();
  createDirectActivityPutClearingTest();
  createDirectActivityPatchClearingTest();
  createLegacyAttributionRepairTest();
  createCoalescedKindFlipValidationTest();
  createClearingBeforeArchiveTest();
});
