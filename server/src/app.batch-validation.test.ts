import { describe, it, expect } from "vitest";
import {
  freshApp,
  account,
  client,
  project,
  activity,
  placeholder,
  allocation,
  timeOff,
  closure,
} from "./fixtures/appTestEntities";
import { call, readErrorResponse, body, post, batch } from "./fixtures/appTestHttp";
import { readFirstProject } from "./fixtures/appTestSnapshotSchedule";
import { readFirstClientName, readClientIds, readProjectId, readValidatedState } from "./fixtures/appTestSnapshotBatch";
import { scaffold } from "./fixtures/appTestScaffold";

function createClosureWriteTest() {
  it("writes closures directly and in a batch, and rejects resource references", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));

    expect((await post(app, "closures", closure("direct-closure", "a1"))).statusCode).toBe(201);
    expect(
      (
        await batch(app, [
          {
            method: "PUT",
            table: "closures",
            id: "batch-closure",
            row: closure("batch-closure", "a1", "New Year shutdown"),
          },
        ])
      ).statusCode,
    ).toBe(200);

    expect((await readValidatedState(app)).closures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "direct-closure", name: "Christmas shutdown" }),
        expect.objectContaining({ id: "batch-closure", name: "New Year shutdown" }),
      ]),
    );
    expect((await post(app, "closures", { ...closure("invalid-closure", "a1"), resourceId: "r1" })).statusCode).toBe(
      400,
    );
  });
}

function createMissingTimeOffResourceTest() {
  it("rejects an omitted time-off resourceId through direct and batch writes", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const missing = timeOff({ id: "missing-resource", accountId: "a1", resourceId: "r1" }) as Record<string, unknown>;
    delete missing.resourceId;

    expect((await post(app, "timeOff", missing)).statusCode).toBe(400);
    expect(
      (await batch(app, [{ method: "PUT", table: "timeOff", id: "missing-resource", row: missing }])).statusCode,
    ).toBe(400);
    expect((await readValidatedState(app)).timeOff).toEqual([]);
  });
}

function createRepeatedTimeOffRollbackTest() {
  it("rolls back a valid time-off row when a later repeated row is invalid", async () => {
    const { app } = freshApp();
    await scaffold(app);

    const response = await batch(app, [
      {
        method: "PUT",
        table: "timeOff",
        id: "repeat-good",
        row: timeOff({ id: "repeat-good", accountId: "a1", resourceId: "r1" }),
      },
      {
        method: "PUT",
        table: "timeOff",
        id: "repeat-bad",
        row: timeOff({ id: "repeat-bad", accountId: "a1", resourceId: "missing" }),
      },
    ]);

    expect(response.statusCode).toBe(400);
    expect((await readValidatedState(app)).timeOff).toHaveLength(0);
  });
}

function createLifecycleDeletePreScanTest() {
  it("rejects a lifecycle DELETE before executing any batch operation", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "clients", client("c1", "a1"));
    await post(app, "clients", client("c2", "a1"));
    await post(app, "projects", project("p1", "a1", "c1")); // p1 under c1
    await post(app, "activities", activity({ id: "t1", accountId: "a1", projectId: "p1" }));
    // The forbidden lifecycle DELETE rejects the whole request before the preceding reparent runs.
    const res = await batch(app, [
      {
        method: "PUT",
        table: "projects",
        id: "p1",
        row: {
          ...project("p1", "a1", "c2"),
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
      { method: "DELETE", table: "clients", id: "c1", accountId: "a1" },
    ]);
    expect(res.statusCode).toBe(400);
    const s = await readValidatedState(app);
    expect(readClientIds(s.clients)).toEqual(["c1", "c2"]);
    expect(s.projects).toHaveLength(1);
    expect(readFirstProject(s.projects).clientId).toBe("c1");
    expect(s.activities).toHaveLength(1);
  });
}

function createAtomicRollbackTest() {
  it("rolls the WHOLE batch back if any op fails (atomic)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    // First op valid (new client c3); second references a missing client → validation 400.
    const res = await batch(app, [
      { method: "PUT", table: "clients", id: "c3", row: client("c3", "a1") },
      {
        method: "PUT",
        table: "projects",
        id: "bad",
        row: project("bad", "a1", "ghost-client"),
      },
    ]);
    expect(res.statusCode).toBe(400);
    const s = await readValidatedState(app);
    expect(s.clients).toHaveLength(0); // c3 rolled back with the bad op — nothing persisted
    expect(s.projects).toHaveLength(0);
  });
}

function createRepeatedAllocationRollbackTest() {
  it("rolls back valid repeated allocations when one generated sibling is invalid", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await batch(app, [
      {
        method: "PUT",
        table: "allocations",
        id: "repeat-good",
        row: allocation({ id: "repeat-good", accountId: "a1", resourceId: "r1", activityId: "t1" }),
      },
      {
        method: "PUT",
        table: "allocations",
        id: "repeat-bad",
        row: allocation({ id: "repeat-bad", accountId: "a1", resourceId: "missing", activityId: "t1" }),
      },
    ]);
    expect(res.statusCode).toBe(400);
    expect((await readValidatedState(app)).allocations).toHaveLength(0);
  });
}

function createPlaceholderRebindRollbackTest() {
  it("rolls back earlier operations when a placeholder rebind would invalidate existing work", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "projects", project("p2", "a1", "c1"));
    await post(app, "resources", placeholder("ph", "a1", "p1"));
    await post(app, "allocations", allocation({ id: "al", accountId: "a1", resourceId: "ph", activityId: "t1" }));

    const res = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: { ...client("c1", "a1"), name: "Must roll back" },
      },
      {
        method: "PUT",
        table: "resources",
        id: "ph",
        row: placeholder("ph", "a1", "p2"),
      },
    ]);

    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/placeholder’s work/i);
    const snapshot = await readValidatedState(app);
    expect(readFirstClientName(snapshot.clients)).toBe("Acme");
    expect(readProjectId(snapshot.resources, "ph")).toBe("p1");
  });
}

function createCrossAccountDeleteRollbackTest() {
  it("refuses a cross-account delete inside a batch and rolls back", async () => {
    const { app } = freshApp();
    await scaffold(app); // c1 in a1
    await post(app, "accounts", account("a2"));
    const res = await batch(app, [{ method: "DELETE", table: "clients", id: "c1", accountId: "a2" }]);
    expect(res.statusCode).toBe(400);
    expect((await readValidatedState(app)).clients).toHaveLength(1); // c1 untouched
  });
}

function createMissingDeleteAccountTest() {
  it("rejects a scoped delete op that omits accountId", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await batch(app, [{ method: "DELETE", table: "clients", id: "c1" }]);
    expect(res.statusCode).toBe(400);
    expect((await readValidatedState(app)).clients).toHaveLength(1);
  });
}

function createInvalidBatchOperationTest() {
  it("rejects an unknown table / bad op shape", async () => {
    const { app } = freshApp();
    expect((await batch(app, [{ method: "PUT", table: "widgets", id: "x", row: { id: "x" } }])).statusCode).toBe(400);
    expect((await batch(app, [{ method: "PUT", table: "clients", id: "c1", row: { id: "OTHER" } }])).statusCode).toBe(
      400,
    );
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/batch",
          payload: body({ nope: true }),
        })
      ).statusCode,
    ).toBe(400);
  });
}

function createNullBatchOperationTest() {
  it("rejects a null operation as a validation error instead of throwing a 500", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/batch",
      payload: body({ ops: [null] }),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/object/i);
  });
}

describe("batch sync (/api/batch — transactional, ordered)", () => {
  createClosureWriteTest();
  createMissingTimeOffResourceTest();
  createRepeatedTimeOffRollbackTest();
  createLifecycleDeletePreScanTest();
  createAtomicRollbackTest();
  createRepeatedAllocationRollbackTest();
  createPlaceholderRebindRollbackTest();
  createCrossAccountDeleteRollbackTest();
  createMissingDeleteAccountTest();
  createInvalidBatchOperationTest();
  createNullBatchOperationTest();
});
