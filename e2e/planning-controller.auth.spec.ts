import { expect, test } from "./fixtures";
import type { APIRequestContext, Page } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

const MODULE_URL = "/src/test/planningServerHarness.ts";
const STAMP = Date.now();
let scenarioNumber = 0;

type Intent = Record<string, unknown> & { operation: string };
interface HarnessState {
  revision: number | null;
  status: string;
  history: { past: number; future: number; tipRevision: number | null };
  pending: { mutationId: string; baseRevision: number; operation: string } | null;
  outcome: string | null;
  context: { companyId: string; identity: string } | null;
  allocations: Array<{
    id: string;
    startDate: string;
    endDate: string;
    resourceId: string;
    activityId: string;
    projectId: string | null;
  }>;
  resourceIds: string[];
  clientIds: string[];
  projectIds: string[];
  activityIds: string[];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

/** Calls a source module through Vite in the authenticated browser without wiring it into the app entry. */
async function callHarness<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ({ moduleUrl, methodName, parameters }) => {
      const module = (await import(moduleUrl)) as Record<string, (...values: unknown[]) => unknown>;
      const action = module[methodName];
      if (typeof action !== "function") throw new Error(`Planning harness method '${methodName}' is missing.`);
      return await action(...parameters);
    },
    { moduleUrl: MODULE_URL, methodName: method, parameters: args },
  ) as Promise<T>;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
}

async function planningSnapshot(request: APIRequestContext, cookie: string, companyId: string) {
  const response = await request.get(`${AUTH_API}/api/accounts/${companyId}/planning`, { headers: { cookie } });
  expect(response.status(), "the authenticated planning read should succeed").toBe(200);
  return (await response.json()) as {
    revision: number;
    data: {
      allocations: Array<{
        id: string;
        startDate: string;
        endDate: string;
        resourceId: string;
        activityId: string;
        projectId: string | null;
      }>;
      resources: Array<{ id: string }>;
      clients: Array<{ id: string }>;
      projects: Array<{ id: string }>;
      activities: Array<{ id: string }>;
    };
  };
}

function uuid(): string {
  return crypto.randomUUID();
}

test("unactivated planning controller uses authenticated typed routes and reconciles acknowledged edits", async ({
  page,
  request,
}) => {
  const suffix = `${STAMP}-${++scenarioNumber}`;
  const ownerEmail = `bruce-wayne-planning-${suffix}@capacitylens.dev`;
  const owner = await signUpUser(ownerEmail, "Bruce Wayne");
  const companyId = await bootstrapOrg(request, owner.cookie, `Wayne Planning ${suffix}`);
  await signIn(page, ownerEmail);

  const primaryKey = `primary-${suffix}`;
  const initial = await callHarness<HarnessState>(page, "initializePlanningServerHarness", primaryKey, companyId);
  const initialSnapshot = await planningSnapshot(request, owner.cookie, companyId);
  expect(Number.isSafeInteger(initialSnapshot.revision)).toBe(true);
  expect(initialSnapshot.revision).toBeGreaterThanOrEqual(0);
  expect(initial).toMatchObject({ status: "ready", revision: initialSnapshot.revision, context: { companyId } });

  const clientId = uuid();
  const projectId = uuid();
  const activityId = uuid();
  const firstResourceId = uuid();
  const secondResourceId = uuid();
  const allocationId = uuid();

  await callHarness(page, "planningHarnessExecute", primaryKey, {
    operation: "catalogue.create",
    entity: { entity: "clients", id: clientId, fields: { name: "Wayne Enterprises", color: "#76a5e7" } },
  } satisfies Intent);
  await callHarness(page, "planningHarnessExecute", primaryKey, {
    operation: "catalogue.create",
    entity: {
      entity: "projects",
      id: projectId,
      fields: { name: "Gotham Renewal", color: "#e776b8", clientId },
    },
  } satisfies Intent);
  await callHarness(page, "planningHarnessExecute", primaryKey, {
    operation: "catalogue.create",
    entity: {
      entity: "activities",
      id: activityId,
      fields: { name: "City planning", kind: "project", projectId, phaseId: null },
    },
  } satisfies Intent);

  const resource = (id: string, name: string) => ({
    operation: "resource.create",
    id,
    fields: {
      kind: "person",
      name,
      role: "Planner",
      avatarUrl: null,
      disciplineId: null,
      employmentType: "permanent",
      engagement: "studio",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      projectId: null,
      color: "#76a5e7",
      isFavourite: false,
      firstAvailableDate: null,
      lastAvailableDate: null,
    },
  });
  await callHarness(
    page,
    "planningHarnessExecute",
    primaryKey,
    resource(firstResourceId, "Bruce Wayne") satisfies Intent,
  );
  await callHarness(
    page,
    "planningHarnessExecute",
    primaryKey,
    resource(secondResourceId, "Dick Grayson") satisfies Intent,
  );

  const sourceAllocation = {
    operation: "allocation.create",
    allocation: {
      id: allocationId,
      resourceId: firstResourceId,
      activityId,
      projectId: null,
      startDate: "2026-10-26",
      endDate: "2026-10-27",
      hoursPerDay: 8,
      status: "confirmed",
    },
  } satisfies Intent;
  await callHarness(page, "planningHarnessExecute", primaryKey, sourceAllocation);

  const seeded = await planningSnapshot(request, owner.cookie, companyId);
  expect(seeded.data.clients).toEqual(expect.arrayContaining([expect.objectContaining({ id: clientId })]));
  expect(seeded.data).toMatchObject({
    projects: [expect.objectContaining({ id: projectId, clientId })],
    activities: [expect.objectContaining({ id: activityId, projectId })],
    resources: expect.arrayContaining([
      expect.objectContaining({ id: firstResourceId, name: "Bruce Wayne" }),
      expect.objectContaining({ id: secondResourceId, name: "Dick Grayson" }),
    ]),
    allocations: [expect.objectContaining({ id: allocationId, startDate: "2026-10-26", endDate: "2026-10-27" })],
  });

  // A real server commit is held before the browser receives its response. The cache must remain pending,
  // without history, until acknowledgement; then a dropped response is recovered by the real lookup route.
  const committedAtServer = deferred<{ status: number; body: unknown }>();
  const releaseResponse = deferred<void>();
  const updatePath = `**/api/accounts/${companyId}/allocations/${allocationId}`;
  await page.route(updatePath, async (route) => {
    const response = await route.fetch();
    committedAtServer.resolve({ status: response.status(), body: await response.json() });
    await releaseResponse.promise;
    await route.abort("failed");
  });
  const heldUpdate = {
    operation: "allocation.update",
    id: allocationId,
    changes: { endDate: "2026-10-29" },
  } satisfies Intent;
  const heldInverse = {
    operation: "allocation.update",
    id: allocationId,
    changes: { endDate: "2026-10-27" },
  } satisfies Intent;
  const started = await (async () => {
    try {
      const pendingStart = await callHarness<{ mutationId: string; baseRevision: number; state: HarnessState }>(
        page,
        "planningHarnessStart",
        primaryKey,
        heldUpdate,
        heldInverse,
      );
      const serverCommit = await committedAtServer.promise;
      expect(serverCommit.status).toBe(200);
      expect(serverCommit.body).toMatchObject({
        status: "committed",
        mutationId: pendingStart.mutationId,
        revision: pendingStart.baseRevision + 1,
      });
      expect(pendingStart.state).toMatchObject({
        status: "pending",
        history: { past: 0 },
        pending: { mutationId: pendingStart.mutationId },
      });
      const whileUnacknowledged = await callHarness<HarnessState>(page, "planningHarnessState", primaryKey);
      expect(whileUnacknowledged).toMatchObject({ status: "pending", history: { past: 0 }, outcome: "pending" });
      const committedSnapshot = await planningSnapshot(request, owner.cookie, companyId);
      expect(committedSnapshot.data.allocations).toContainEqual(
        expect.objectContaining({ id: allocationId, endDate: "2026-10-29" }),
      );
      return pendingStart;
    } finally {
      releaseResponse.resolve();
      // Wait for the held handler to abort before interception removal releases the request.
      await page.unrouteAll({ behavior: "wait" });
    }
  })();
  const lostResponse = await callHarness<{ result: { kind: string }; state: HarnessState }>(
    page,
    "planningHarnessFinish",
    primaryKey,
  );
  expect(lostResponse).toMatchObject({
    result: { kind: "rejected" },
    state: { status: "uncertain", outcome: "uncertain" },
  });

  const recovered = await callHarness<{
    result: boolean;
    state: HarnessState;
    executions: Array<{ mutationId: string; baseRevision: number }>;
  }>(page, "planningHarnessReconcile", primaryKey);
  expect(recovered).toMatchObject({
    result: true,
    state: {
      status: "ready",
      history: { past: 1, tipRevision: started.baseRevision + 1 },
    },
  });
  expect(recovered.executions.filter(({ mutationId }) => mutationId === started.mutationId)).toHaveLength(1);

  const sameRevision = await callHarness<{ refreshed: boolean; state: HarnessState }>(
    page,
    "planningHarnessRefresh",
    primaryKey,
  );
  expect(sameRevision).toMatchObject({ refreshed: true, state: { history: { past: 1 } } });
  const beforeUndo = recovered.state.revision;
  const undo = await callHarness<{
    result: boolean;
    executions: Array<{ mutationId: string; baseRevision: number }>;
    state: HarnessState;
  }>(page, "planningHarnessUndo", primaryKey);
  expect(undo.result).toBe(true);
  expect(undo.state.allocations).toContainEqual(expect.objectContaining({ id: allocationId, endDate: "2026-10-27" }));
  expect(undo.executions.at(-1)).toMatchObject({ baseRevision: beforeUndo });
  expect(undo.executions.at(-1)?.mutationId).not.toBe(started.mutationId);
  const redo = await callHarness<{
    result: boolean;
    executions: Array<{ mutationId: string; baseRevision: number }>;
    state: HarnessState;
  }>(page, "planningHarnessRedo", primaryKey);
  expect(redo.result).toBe(true);
  expect(redo.state.allocations).toContainEqual(expect.objectContaining({ id: allocationId, endDate: "2026-10-29" }));
  expect(redo.executions.at(-1)?.baseRevision).toBe(undo.state.revision);
  expect(redo.executions.at(-1)?.mutationId).not.toBe(undo.executions.at(-1)?.mutationId);

  // A second authenticated client changes the same row. The primary client's refresh clears old history,
  // and its captured draft is refused at the original revision rather than rebased or replayed.
  const staleDraft = await callHarness<{ baseRevision: number }>(
    page,
    "planningHarnessCaptureDraft",
    primaryKey,
    "before-peer-write",
  );
  expect(staleDraft.baseRevision).toBe(redo.state.revision);
  const peerKey = `peer-${suffix}`;
  await callHarness(page, "initializePlanningServerHarness", peerKey, companyId);
  await callHarness(
    page,
    "planningHarnessExecute",
    peerKey,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { status: "tentative" },
    } satisfies Intent,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { status: "confirmed" },
    } satisfies Intent,
  );
  const externalRefresh = await callHarness<{ refreshed: boolean; state: HarnessState }>(
    page,
    "planningHarnessRefresh",
    primaryKey,
  );
  expect(externalRefresh.state.history).toMatchObject({ past: 0, future: 0 });
  const beforeStaleCount = (
    await callHarness<Array<{ mutationId: string }>>(page, "planningHarnessExecutions", primaryKey)
  ).length;
  const stale = await callHarness<{
    result: { kind: string; code?: string; status?: number };
    state: HarnessState;
  }>(
    page,
    "planningHarnessExecuteDraft",
    primaryKey,
    "before-peer-write",
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { startDate: "2026-10-28" },
    } satisfies Intent,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { startDate: "2026-10-26" },
    } satisfies Intent,
  );
  expect(stale.result).toMatchObject({ kind: "rejected", code: "stale_revision", status: 409 });
  expect(stale.state.status).toBe("ready");
  expect(await callHarness<Array<{ mutationId: string }>>(page, "planningHarnessExecutions", primaryKey)).toHaveLength(
    beforeStaleCount + 1,
  );

  // A new deliberate action uses the refreshed revision; move, resize, reassign, duplicate and repeat all
  // exercise generated typed routes and are confirmed by the server's canonical read.
  await callHarness(
    page,
    "planningHarnessExecute",
    primaryKey,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { startDate: "2026-10-28" },
    } satisfies Intent,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { startDate: "2026-10-26" },
    } satisfies Intent,
  );
  await callHarness(
    page,
    "planningHarnessExecute",
    primaryKey,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { resourceId: secondResourceId },
    } satisfies Intent,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { resourceId: firstResourceId },
    } satisfies Intent,
  );
  await callHarness(
    page,
    "planningHarnessExecute",
    primaryKey,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { endDate: "2026-10-30" },
    } satisfies Intent,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { endDate: "2026-10-29" },
    } satisfies Intent,
  );

  const duplicateId = uuid();
  await callHarness(
    page,
    "planningHarnessExecute",
    primaryKey,
    {
      operation: "allocation.duplicate",
      sourceAllocationId: allocationId,
      occurrence: { id: duplicateId, startDate: "2026-11-02", endDate: "2026-11-04" },
    } satisfies Intent,
    null,
  );
  const repeatIds = [uuid(), uuid()];
  await callHarness(
    page,
    "planningHarnessExecute",
    primaryKey,
    {
      operation: "allocation.repeat",
      sourceAllocationId: allocationId,
      occurrences: [
        { id: repeatIds[0], startDate: "2026-11-09", endDate: "2026-11-11" },
        { id: repeatIds[1], startDate: "2026-11-16", endDate: "2026-11-18" },
      ],
    } satisfies Intent,
    null,
  );
  const completeSnapshot = await planningSnapshot(request, owner.cookie, companyId);
  expect(completeSnapshot.data.allocations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: allocationId,
        resourceId: secondResourceId,
        startDate: "2026-10-28",
        endDate: "2026-10-30",
      }),
      expect.objectContaining({
        id: duplicateId,
        resourceId: secondResourceId,
        startDate: "2026-11-02",
        endDate: "2026-11-04",
      }),
      expect.objectContaining({ id: repeatIds[0], startDate: "2026-11-09", endDate: "2026-11-11" }),
      expect.objectContaining({ id: repeatIds[1], startDate: "2026-11-16", endDate: "2026-11-18" }),
    ]),
  );

  // A request lost before dispatch has no commitment marker. Lookup remains unknown and blocks retries.
  const unknownRoute = `**/api/accounts/${companyId}/allocations/${allocationId}`;
  await page.route(unknownRoute, async (route) => route.abort("failed"));
  const unknownStart = await callHarness<{ mutationId: string }>(
    page,
    "planningHarnessStart",
    primaryKey,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { status: "confirmed" },
    } satisfies Intent,
    {
      operation: "allocation.update",
      id: allocationId,
      changes: { status: "tentative" },
    } satisfies Intent,
  );
  await callHarness(page, "planningHarnessFinish", primaryKey);
  const unknownLookup = await callHarness<{ result: boolean; state: HarnessState }>(
    page,
    "planningHarnessReconcile",
    primaryKey,
  );
  expect(unknownLookup).toMatchObject({
    result: false,
    state: { status: "uncertain", outcome: "uncertain", pending: { mutationId: unknownStart.mutationId } },
  });
  const attemptsBeforeRetry = (
    await callHarness<Array<{ mutationId: string }>>(page, "planningHarnessExecutions", primaryKey)
  ).length;
  await expect(
    callHarness(page, "planningHarnessExecute", primaryKey, {
      operation: "allocation.update",
      id: allocationId,
      changes: { status: "confirmed" },
    } satisfies Intent),
  ).rejects.toThrow(/ready|pending|uncertain/i);
  expect(await callHarness<Array<{ mutationId: string }>>(page, "planningHarnessExecutions", primaryKey)).toHaveLength(
    attemptsBeforeRetry,
  );
  await page.unroute(unknownRoute);

  const cleared = await callHarness<{ signOutStatus: number; refreshed: boolean; state: HarnessState }>(
    page,
    "planningHarnessSignOut",
    primaryKey,
  );
  expect(cleared).toMatchObject({
    signOutStatus: 200,
    refreshed: false,
    state: { context: null, status: "idle", allocations: [] },
  });
});
