import { describe, it, expect } from "vitest";
import { insertRow } from "./db";
import { addDaysISO } from "@capacitylens/shared/lib/dateMath";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import {
  CROSS_ACCOUNT_ACTIVITY_ERROR,
  meta,
  freshApp,
  account,
  client,
  project,
  activity,
  person,
  placeholder,
  allocation,
  timeOff,
} from "./fixtures/appTestEntities";
import { readErrorResponse, post, put, patch } from "./fixtures/appTestHttp";
import { readResource } from "./fixtures/appTestSnapshotAccount";
import { readProjectId, readValidatedState } from "./fixtures/appTestSnapshotBatch";
import { scaffold } from "./fixtures/appTestScaffold";

function createRequiredWriteValidationTests(): void {
  it("rejects a null time-off resource", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));

    const response = await post(app, "timeOff", {
      ...timeOff({ id: "invalid-time-off", accountId: "a1", resourceId: "r1" }),
      resourceId: null,
    });

    expect(response.statusCode).toBe(400);
    expect((await readValidatedState(app)).timeOff).toEqual([]);
  });

  it("rejects direct writes that omit values only the import path may repair", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await post(app, "resources", {
      id: "r1",
      accountId: "a1",
      name: "Ada",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/missing required field.*kind/i);
    expect((await readValidatedState(app)).resources).toEqual([]);
  });
}

function createParentWriteValidationTests(): void {
  it("rejects missing required project and phase parents at the shared boundary", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "clients", client("c1", "a1"));

    const missingClient = await post(app, "projects", {
      id: "p1",
      accountId: "a1",
      name: "Project",
      color: "#5c34d4",
      ...meta(),
    });
    expect(missingClient.statusCode).toBe(400);
    expect(readErrorResponse(missingClient).error).toBe("Project must reference a client in this company.");
    expect(readErrorResponse(missingClient).code).toBe("reference_wrong_account");

    await post(app, "projects", project("p2", "a1", "c1"));
    const missingClientOnReplace = await put({
      app,
      entity: "projects",
      id: "p2",
      payload: {
        id: "p2",
        accountId: "a1",
        name: "Replacement",
        color: "#5c34d4",
        ...meta(),
      },
    });
    expect(missingClientOnReplace.statusCode).toBe(400);
    expect(readErrorResponse(missingClientOnReplace).error).toBe("Project must reference a client in this company.");
    expect((await patch({ app, entity: "projects", id: "p2", payload: { name: "Partial rename" } })).statusCode).toBe(
      200,
    );

    const missingProject = await post(app, "phases", {
      id: "ph1",
      accountId: "a1",
      name: "Phase",
      ...meta(),
    });
    expect(missingProject.statusCode).toBe(400);
    expect(readErrorResponse(missingProject).error).toBe("Phase must reference a project in this company.");
  });

  it("rejects a project referencing a client outside the account", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await post(app, "projects", project("p1", "a1", "no-such-client"));
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/client/i);
  });
}

function createAllocationRangeOrderValidationTest(): void {
  it("rejects a reversed allocation date range", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await post(
      app,
      "allocations",
      allocation({
        id: "bad",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: {
          startDate: "2026-02-10",
          endDate: "2026-02-01",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/end date/i);
  });
}

function createSchedulingSpanValidationTest(): void {
  it("accepts the maximum scheduling span and rejects longer allocation and time-off writes", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const startDate = "2026-01-01";
    const atLimit = addDaysISO(startDate, MAX_SPAN_DAYS - 1);
    const overLimit = addDaysISO(startDate, MAX_SPAN_DAYS);

    expect(
      (
        await post(
          app,
          "allocations",
          allocation({
            id: "at-limit",
            accountId: "a1",
            resourceId: "r1",
            activityId: "t1",
            o: {
              startDate,
              endDate: atLimit,
            },
          }),
        )
      ).statusCode,
    ).toBe(201);

    const allocationResponse = await post(
      app,
      "allocations",
      allocation({
        id: "over-limit",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: {
          startDate,
          endDate: overLimit,
        },
      }),
    );
    expect(allocationResponse.statusCode).toBe(400);
    expect(readErrorResponse(allocationResponse).error).toBe("Date span cannot exceed 36,500 calendar days.");

    const timeOffResponse = await post(app, "timeOff", {
      id: "to-over-limit",
      accountId: "a1",
      resourceId: "r1",
      startDate,
      endDate: overLimit,
      type: "holiday",
      ...meta(),
    });
    expect(timeOffResponse.statusCode).toBe(400);
    expect(readErrorResponse(timeOffResponse).error).toBe("Date span cannot exceed 36,500 calendar days.");
  });
}

function createPlaceholderWriteValidationTests(): void {
  it("rejects a placeholder assigned outside its bound project", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "projects", project("p2", "a1", "c1"));
    await post(app, "activities", activity({ id: "t2", accountId: "a1", projectId: "p2" }));
    await post(app, "resources", placeholder("ph", "a1", "p1")); // bound to p1
    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "ph", activityId: "t2" }),
    ); // t2 is in p2
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/placeholder/i);
  });

  it("rejects parent edits that would invalidate an existing placeholder allocation", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "projects", project("p2", "a1", "c1"));
    await post(app, "resources", placeholder("ph", "a1", "p1"));
    await post(app, "allocations", allocation({ id: "al", accountId: "a1", resourceId: "ph", activityId: "t1" }));

    const rebind = await patch({ app, entity: "resources", id: "ph", payload: { projectId: "p2" } });
    expect(rebind.statusCode).toBe(400);
    expect(readErrorResponse(rebind).error).toMatch(/placeholder’s work/i);

    const reproject = await patch({ app, entity: "activities", id: "t1", payload: { projectId: "p2" } });
    expect(reproject.statusCode).toBe(400);
    expect(readErrorResponse(reproject).error).toMatch(/placeholder work/i);

    const snapshot = await readValidatedState(app);
    expect(readProjectId(snapshot.resources, "ph")).toBe("p1");
    expect(readProjectId(snapshot.activities, "t1")).toBe("p1");
  });
}

function createAllocationReferenceValidationTests(): void {
  it("rejects an allocation referencing a missing resource/activity", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "ghost", activityId: "t1" }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("fails closed when a corrupt project-bound activity points at another account's project", async () => {
    const { app, db } = freshApp(true, { multiAccount: true });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));
    await post(app, "clients", client("c2", "a2"));
    await post(app, "projects", project("p2", "a2", "c2"));
    await post(app, "resources", person("r1", "a1"));

    // The ordinary activity route and current database trigger reject this mismatch. Remove that
    // one insert trigger to model post-start operator tampering and prove the allocation write
    // boundary independently re-checks the project tenant.
    db.exec("DROP TRIGGER capacitylens_tenant_activities_projectId_insert");
    insertRow(db, "activities", activity({ id: "cross-project", accountId: "a1", projectId: "p2" }));

    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "r1", activityId: "cross-project" }),
    );
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toBe(CROSS_ACCOUNT_ACTIVITY_ERROR);
  });
}

function createExternalResourceWriteValidationTests(): void {
  it("rejects a non-zero allocation load on an external / 3rd-party resource (no capacity)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "resources", { ...person("ext", "a1"), kind: "external" });
    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "ext", activityId: "t1", o: { hoursPerDay: 8 } }),
    );
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/external/i);
  });

  it("accepts a zero-load allocation on an external resource (the form forces 0)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "resources", { ...person("ext", "a1"), kind: "external" });
    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "ext", activityId: "t1", o: { hoursPerDay: 0 } }),
    );
    expect(res.statusCode).toBe(201);
  });

  it("rejects time off on an external / 3rd-party resource (no capacity)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "resources", { ...person("ext", "a1"), kind: "external" });
    const res = await post(app, "timeOff", {
      id: "to1",
      accountId: "a1",
      resourceId: "ext",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      type: "holiday",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/external/i);
  });
}

function createExternalResourceConversionRejectionTests(): void {
  // Flipping a resource to external while it still owns loaded work / time-off would orphan those
  // dependents (the scheduler hides external capacity + time-off). The server rejects the flip on
  // BOTH the full-row PUT and the partial PATCH merge — same shared assert as the store.
  it("rejects PATCH setting kind:external on a resource that has a loaded allocation", async () => {
    const { app } = freshApp();
    await scaffold(app); // r1 is a person
    await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "r1", activityId: "t1", o: { hoursPerDay: 8 } }),
    );
    const res = await patch({ app, entity: "resources", id: "r1", payload: { kind: "external" } });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/work and time off/i);
  });

  it("rejects PUT setting kind:external on a resource that has time off", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "timeOff", {
      id: "to1",
      accountId: "a1",
      resourceId: "r1",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      type: "holiday",
      ...meta(),
    });
    const res = await put({
      app,
      entity: "resources",
      id: "r1",
      payload: {
        ...person("r1", "a1"),
        kind: "external",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/work and time off/i);
  });
}

function createExternalResourceConversionAcceptanceTests(): void {
  it("accepts flipping a resource to external when it has NO disallowed dependents (zero-load allocation is fine)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // A zero-load allocation is already valid for an external, so it must NOT block the flip.
    await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "r1", activityId: "t1", o: { hoursPerDay: 0 } }),
    );
    expect((await patch({ app, entity: "resources", id: "r1", payload: { kind: "external" } })).statusCode).toBe(200);
    expect(readResource((await readValidatedState(app)).resources, "r1").kind).toBe("external");
  });

  it("accepts creating an external resource with no dependents, and editing its name", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect(
      (
        await post(app, "resources", {
          ...person("ext", "a1"),
          kind: "external",
        })
      ).statusCode,
    ).toBe(201);
    expect((await patch({ app, entity: "resources", id: "ext", payload: { role: "Overflow" } })).statusCode).toBe(200);
  });
}

describe("validation (shared domain-core) rejects bad writes with 400", () => {
  createRequiredWriteValidationTests();
  createParentWriteValidationTests();
  createAllocationRangeOrderValidationTest();
  createSchedulingSpanValidationTest();
  createPlaceholderWriteValidationTests();
  createAllocationReferenceValidationTests();
  createExternalResourceWriteValidationTests();
  createExternalResourceConversionRejectionTests();
  createExternalResourceConversionAcceptanceTests();
});
