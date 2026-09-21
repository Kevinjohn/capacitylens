import { describe, it, expect, vi } from "vitest";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { runImportWorker } from "./runImportWorker";
import type { AuditEntry } from "./audit";
import { WorkQueueFullError } from "./workQueue";
import { emptyAppData, EXPORT_SCHEMA_VERSION } from "@capacitylens/shared/types/entities";
import {
  TS,
  meta,
  deferred,
  freshApp,
  account,
  client,
  project,
  activity,
  person,
  allocation,
  timeOff,
  closure,
} from "./fixtures/appTestEntities";
import { call, readErrorResponse, post, put, batch } from "./fixtures/appTestHttp";
import { readFirstProject } from "./fixtures/appTestSnapshotSchedule";
import { readOnlyTimeOff, readFirstResource } from "./fixtures/appTestSnapshotAccount";
import {
  readAllStateClients,
  readFirstProjectId,
  readSuccessfulStateResponse,
  readStateResponse,
  readImportSummary,
  readValidatedState,
  state,
} from "./fixtures/appTestSnapshotBatch";

function createInternalClientCreationRejectionTests(): void {
  it("rejects replacing the generated Internal client id", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "projects", project("p-internal", "a1", "internal:a1"));
    await post(app, "activities", activity({ id: "t-internal", accountId: "a1", projectId: "p-internal" }));
    await post(app, "resources", person("r1", "a1"));
    await post(
      app,
      "allocations",
      allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t-internal" }),
    );

    const replacement = await post(app, "clients", {
      ...client("legacy-internal", "a1"),
      builtin: true,
    });
    expect(replacement.statusCode).toBe(400);
    const snapshot = readStateResponse(await call(app, { method: "GET", url: "/api/state?accountId=a1" }));
    expect(snapshot.projects.find((projectRow) => projectRow.id === "p-internal")?.clientId).toBe("internal:a1");
    expect(snapshot.activities.some((activityRow) => activityRow.id === "t-internal")).toBe(true);
    expect(snapshot.allocations.some((allocationRow) => allocationRow.id === "al1")).toBe(true);
  });

  it("rejects every generic attempt to create a builtin client", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await post(app, "clients", { ...client("c-int", "a1"), builtin: true })).statusCode).toBe(400);
    const dup = await post(app, "clients", {
      ...client("c-int2", "a1"),
      builtin: true,
    });
    expect(dup.statusCode).toBe(400);
    expect(readErrorResponse(dup).error).toMatch(/built-in|Internal/i);
  });
}

function createInternalClientMutationRejectionTests(): void {
  it("rejects generic updates to the generated builtin client", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await put({
      app,
      entity: "clients",
      id: "internal:a1",
      payload: {
        ...client("internal:a1", "a1"),
        name: "Renamed",
        builtin: true,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a counterfeit same-batch duplicate of a freshly generated Internal client", async () => {
    const { app } = freshApp();
    const res = await batch(app, [
      { method: "PUT", table: "accounts", id: "a1", row: account("a1") },
      {
        method: "PUT",
        table: "clients",
        id: "internal:a1",
        row: {
          ...client("internal:a1", "a1"),
          name: "Counterfeit built-in",
          color: "#ffffff",
          builtin: false,
        },
      },
    ]);

    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/generated|built-in|Internal/i);
    expect((await readValidatedState(app)).accounts).toEqual([]);
    expect((await readValidatedState(app)).clients).toEqual([]);
  });
}

function createInternalClientSingletonAcceptanceTests(): void {
  it("accepts the canonical same-batch duplicate of a freshly generated Internal client", async () => {
    const auditEntries: AuditEntry[] = [];
    const { app } = freshApp(true, {
      audit: {
        append: (entry) => {
          auditEntries.push(entry);
          return true;
        },
        degraded: false,
      },
    });
    const res = await batch(app, [
      { method: "PUT", table: "accounts", id: "a1", row: account("a1") },
      {
        method: "PUT",
        table: "clients",
        id: "internal:a1",
        row: buildInternalClient("a1", TS),
      },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, applied: 2, changed: 1 });
    expect(
      auditEntries.filter((entry) => "entity" in entry).map(({ entity, action, id }) => ({ entity, action, id })),
    ).toEqual([{ entity: "accounts", action: "create", id: "a1" }]);
    const storedClients = readAllStateClients(await call(app, { method: "GET", url: "/api/state" }));
    expect(storedClients).toMatchObject([
      {
        id: "internal:a1",
        accountId: "a1",
        name: "Internal",
        builtin: true,
      },
    ]);
  });

  it("creates one protected builtin in each account", async () => {
    // multiAccount: true — this test deliberately creates a SECOND company on one instance, which
    // the default single-company cap would otherwise 403 (see app.singleCompanyCap.test.ts for the
    // cap's own coverage); this test is about per-account builtin scoping, not the cap.
    const { app } = freshApp(true, { multiAccount: true });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));
    expect(
      (
        await post(app, "clients", {
          ...client("c-int-1", "a1"),
          builtin: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(app, "clients", {
          ...client("c-int-2", "a2"),
          builtin: true,
        })
      ).statusCode,
    ).toBe(400);
    const clients = readAllStateClients(await call(app, { method: "GET", url: "/api/state" }));
    expect(clients.filter((clientRow) => clientRow.builtin)).toHaveLength(2);
  });
}

describe("built-in Internal client is a per-account singleton on direct writes", () => {
  createInternalClientCreationRejectionTests();
  createInternalClientMutationRejectionTests();
  createInternalClientSingletonAcceptanceTests();
});

async function testBoundedImportSaturation(): Promise<void> {
  const { app } = freshApp(true, {
    importWorker: async () => {
      throw new WorkQueueFullError("Import preparation is temporarily at capacity. Retry shortly.");
    },
  });
  await post(app, "accounts", account("a1"));

  const response = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: exportFile("source") },
  });

  expect(response.statusCode).toBe(503);
  expect(response.headers["retry-after"]).toBe("1");
  expect(response.json()).toEqual({
    error: "Import preparation is temporarily at capacity. Retry shortly.",
    code: "IMPORT_BUSY",
    retryable: true,
  });
}

function exportFile(accountId: string) {
  return {
    schemaVersion: 3,
    data: {
      accounts: [],
      clients: [client("src-c", accountId)],
      disciplines: [],
      projects: [project("src-p", accountId, "src-c")],
      phases: [],
      resources: [person("src-r", accountId)],
      activities: [activity({ id: "src-t", accountId, projectId: "src-p" })],
      allocations: [
        allocation({ id: "src-al", accountId, resourceId: "src-r", activityId: "src-t" }),
        allocation({ id: "bad", accountId, resourceId: "src-r", activityId: "no-activity" }), // dropped: dangling activity
      ],
      timeOff: [],
    },
  };
}

async function testImportTimeOffAndClosures(): Promise<void> {
  const { app } = freshApp(true, { multiAccount: true });
  await post(app, "accounts", account("a1"));
  await post(app, "accounts", account("a2"));
  const missingResource = timeOff({
    id: "missing-resource",
    accountId: "source",
    resourceId: "source-person",
  }) as Record<string, unknown>;
  delete missingResource.resourceId;
  const file = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    data: {
      ...emptyAppData(),
      resources: [person("source-person", "source")],
      timeOff: [timeOff({ id: "personal", accountId: "source", resourceId: "source-person" }), missingResource],
      closures: [closure("company", "source")],
    },
  };

  const firstImport = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: file },
  });
  expect(firstImport.statusCode).toBe(200);
  expect(firstImport.json()).toMatchObject({ imported: 3, skipped: 1 });

  const exported = await call(app, {
    method: "GET",
    url: "/api/state?accountId=a1&includeInactive=1",
  });
  const { state: exportedState, value: exportedValue } = readSuccessfulStateResponse(exported);
  expect(exportedState.timeOff).toHaveLength(1);
  expect(exportedState.closures).toEqual([
    expect.objectContaining({ name: "Christmas shutdown", startDate: "2026-12-24", endDate: "2026-12-27" }),
  ]);

  const secondImport = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a2", data: { schemaVersion: EXPORT_SCHEMA_VERSION, data: exportedValue } },
  });
  expect(secondImport.statusCode).toBe(200);
  expect(secondImport.json()).toMatchObject({ imported: 3, skipped: 0 });

  const roundTripped = await call(app, { method: "GET", url: "/api/state?accountId=a2" });
  const roundTrippedTimeOff = readOnlyTimeOff(readStateResponse(roundTripped).timeOff);
  expect(typeof roundTrippedTimeOff.resourceId).toBe("string");
  expect(roundTrippedTimeOff.type).toBe("holiday");
  expect(readStateResponse(roundTripped).closures).toEqual([expect.objectContaining({ name: "Christmas shutdown" })]);
}

async function testImportWithFreshIds(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: exportFile("whatever") },
  });
  expect(res.statusCode).toBe(200);
  const out = readImportSummary(res);
  expect(out.imported).toBe(5); // client, project, resource, activity, 1 valid allocation
  expect(out.skipped).toBe(1); // the dangling allocation
  const s = await readValidatedState(app);
  const proj = readFirstProject(s.projects);
  expect(proj.id).not.toBe("src-p");
  expect(proj.accountId).toBe("a1");
  expect(readFirstProjectId(s.activities)).toBe(proj.id); // FK rewired to the new project id
  expect(s.allocations).toHaveLength(1);
}

async function testStaleImportConflict(): Promise<void> {
  const workerStarted = deferred();
  const releaseWorker = deferred();
  const auditedActions: string[] = [];
  const appendAudit = vi.fn((record: AuditEntry) => {
    auditedActions.push(record.action);
    return true;
  });
  const { app } = freshApp(true, {
    audit: { append: appendAudit, degraded: false },
    importWorker: async (request) => {
      workerStarted.resolve();
      await releaseWorker.promise;
      return runImportWorker(request);
    },
  });
  await post(app, "accounts", account("a1"));
  auditedActions.length = 0;

  const importing = call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: exportFile("source") },
  });
  await workerStarted.promise;

  const concurrentWrite = await post(app, "resources", person("concurrent", "a1"));
  expect(concurrentWrite.statusCode).toBe(201);
  releaseWorker.resolve();

  const response = await importing;
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({
    error: "The company data changed while the import was being prepared. Retry the import from the latest data.",
    code: "IMPORT_SNAPSHOT_STALE",
  });
  const current = await readValidatedState(app);
  expect(current.resources).toContainEqual(expect.objectContaining({ id: "concurrent", accountId: "a1" }));
  expect(current.clients).not.toContainEqual(expect.objectContaining({ name: "Acme", builtin: false }));
  expect(auditedActions).not.toContain("import");
}

async function testCrossAccountImportConcurrency(): Promise<void> {
  const workerStarted = deferred();
  const releaseWorker = deferred();
  const { app } = freshApp(true, {
    multiAccount: true,
    importWorker: async (request) => {
      workerStarted.resolve();
      await releaseWorker.promise;
      return runImportWorker(request);
    },
  });
  await post(app, "accounts", account("a1"));
  await post(app, "accounts", account("a2"));

  const importing = call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: exportFile("source") },
  });
  await workerStarted.promise;

  const concurrentWrite = await post(app, "resources", person("a2-concurrent", "a2"));
  expect(concurrentWrite.statusCode).toBe(201);
  releaseWorker.resolve();

  const response = await importing;
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ imported: 5, skipped: 1 });
  const current = await readValidatedState(app);
  expect(current.resources).toContainEqual(expect.objectContaining({ id: "a2-concurrent", accountId: "a2" }));
  expect(current.projects).toContainEqual(expect.objectContaining({ accountId: "a1" }));
}

async function testDeletedResourceImportPrivacy(): Promise<void> {
  const { app, db } = freshApp();
  await post(app, "accounts", account("a1"));
  const deleted = {
    ...person("src-r", "source"),
    name: "Named Person",
    archivedAt: "2026-01-02T00:00:00.000Z",
    deletedAt: "2026-01-03T00:00:00.000Z",
  };
  const file = {
    schemaVersion: 3,
    data: {
      accounts: [],
      clients: [client("src-c", "source")],
      disciplines: [],
      projects: [project("src-p", "source", "src-c")],
      phases: [],
      activities: [activity({ id: "src-t", accountId: "source", projectId: "src-p" })],
      resources: [deleted],
      allocations: [
        allocation({
          id: "src-al",
          accountId: "source",
          resourceId: "src-r",
          activityId: "src-t",
          o: {
            note: "Private project context",
          },
        }),
      ],
      timeOff: [
        {
          id: "src-to",
          accountId: "source",
          resourceId: "src-r",
          startDate: "2026-01-01",
          endDate: "2026-01-03",
          type: "sick",
          note: "Private medical detail",
          ...meta(),
        },
      ],
    },
  };

  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: file },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ imported: 6, skipped: 0 });
  const importedResource = db.prepare(`SELECT name, deletedAt FROM resources WHERE accountId = 'a1'`).get() as {
    name: string;
    deletedAt: string | null;
  };
  expect(importedResource.name).toMatch(/^Removed person #[a-zA-Z0-9]{12}$/);
  expect(importedResource.deletedAt).toBe(deleted.deletedAt);
  expect(db.prepare(`SELECT note FROM allocations WHERE accountId = 'a1'`).get()).toEqual({ note: null });
  expect(db.prepare(`SELECT note FROM timeOff WHERE accountId = 'a1'`).get()).toEqual({ note: null });
}

async function testDanglingImportForeignKeys(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  // A hand-edited file: a project/phase whose required parent is absent (must be
  // dropped before SQLite's FKs reject the whole import), and an activity/resource whose
  // OPTIONAL parent is absent (must survive, unbound to general / no discipline).
  const file = {
    schemaVersion: 3,
    data: {
      accounts: [],
      clients: [],
      disciplines: [],
      projects: [project("dp", "x", "ghost-client")], // dropped: missing client
      phases: [
        {
          id: "dph",
          accountId: "x",
          name: "P",
          projectId: "ghost-project",
          ...meta(),
        },
      ], // dropped
      resources: [{ ...person("dr", "x"), disciplineId: "ghost-disc" }], // kept, discipline unbound
      activities: [activity({ id: "dt", accountId: "x", projectId: "ghost-project" })], // kept, unbound to a general activity
      allocations: [],
      timeOff: [],
    },
  };
  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: file },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ imported: 2, skipped: 2 });
  const s = await readValidatedState(app);
  expect(s.projects).toHaveLength(0);
  expect(s.phases).toHaveLength(0);
  expect(s.activities).toHaveLength(1);
  expect(readFirstProjectId(s.activities)).toBeUndefined(); // unbound → general activity
  expect(s.resources).toHaveLength(1);
  expect(readFirstResource(s.resources).disciplineId).toBeUndefined(); // unbound discipline
}

async function testLegacyImportMigration(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  const lr = person("lr", "x") as Record<string, unknown>;
  delete lr.employmentType;
  lr.isFreelancer = true;
  const legacy = { schemaVersion: 1, data: { resources: [lr] } };
  await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: legacy },
  });
  const s = await readValidatedState(app);
  expect(readFirstResource(s.resources).employmentType).toBe("freelancer");
  expect("isFreelancer" in readFirstResource(s.resources)).toBe(false);
}

async function testImportRequiresAccountId(): Promise<void> {
  const { app } = freshApp();
  expect(
    (
      await call(app, {
        method: "POST",
        url: "/api/import",
        payload: { data: {} },
      })
    ).statusCode,
  ).toBe(400);
}

async function testRejectsNonCapacityLensImport(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: { nope: true } },
  });
  expect(res.statusCode).toBe(400);
}

async function testRejectsMalformedImportVersion(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  await post(app, "resources", person("existing", "a1"));
  const before = await state(app);

  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: {
      accountId: "a1",
      data: {
        schemaVersion: "10",
        data: {
          resources: [person("incoming", "source")],
          futureRecords: [{ id: "would-be-lost" }],
        },
      },
    },
  });

  expect(res.statusCode).toBe(400);
  expect(readErrorResponse(res).error).toMatch(/schema version must be a non-negative safe integer/i);
  expect(await state(app)).toEqual(before);
}

describe("import", () => {
  it("reports bounded import saturation as retryable service pressure", testBoundedImportSaturation);
  it("atomically imports personal time off and closures with fresh foreign keys", testImportTimeOffAndClosures);
  it("imports into an account with fresh ids + remapped FKs, dropping invalid rows", testImportWithFreshIds);
  it(
    "refuses a stale import instead of erasing a same-account write committed during preparation",
    testStaleImportConflict,
  );
  it("does not conflict an import when another account changes during preparation", testCrossAccountImportConcurrency);
  it("does not persist dependent private notes imported for a deleted resource", testDeletedResourceImportPrivacy);
  it("drops records with dangling required FKs and unbinds dangling optional ones", testDanglingImportForeignKeys);
  it("runs the v1→v2 migration on imported data (isFreelancer → employmentType)", testLegacyImportMigration);
  it("requires an accountId", testImportRequiresAccountId);
  it("rejects non-CapacityLens data", testRejectsNonCapacityLensImport);
  it("rejects a malformed present schema version without replacing account data", testRejectsMalformedImportVersion);
});
