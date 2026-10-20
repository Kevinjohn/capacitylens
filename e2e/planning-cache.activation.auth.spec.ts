import { expect, test } from "./fixtures";
import type { APIRequestContext, Page } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, seedFixtureMember, signUpUser } from "./authTestSupport";
import { goToSeedWeek, selectShadOption, setZoom, waitForAppLanding } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
let scenarioNumber = 0;

type Allocation = {
  id: string;
  startDate: string;
  endDate: string;
  resourceId: string;
  activityId: string;
  status?: string;
  seriesId?: string | null;
};

type PlanningRead = {
  revision: number;
  data: {
    allocations: Array<Allocation & { projectId?: string | null }>;
    activities: Array<{
      id: string;
      kind: "project" | "internal" | "repeatable";
      projectId: string | null;
      phaseId: string | null;
    }>;
    timeOff: Array<{
      id: string;
      resourceId: string;
      startDate: string;
      endDate: string;
      type: string;
      note?: string | null;
    }>;
  };
};

async function scenario(request: APIRequestContext) {
  const suffix = `${STAMP}-${++scenarioNumber}`;
  const ownerEmail = `bruce-wayne-plan-cache-${suffix}@capacitylens.dev`;
  const owner = await signUpUser(ownerEmail, "Bruce Wayne");
  const accountId = await bootstrapOrg(request, owner.cookie, `Wayne Planning ${suffix}`);
  const now = new Date().toISOString();
  const scoped = { accountId, createdAt: now, updatedAt: now };
  const ids = {
    resourceId: `resource-${suffix}`,
    clientId: `client-${suffix}`,
    projectId: `project-${suffix}`,
    activityId: `activity-${suffix}`,
  };
  for (const [table, id, row] of [
    [
      "resources",
      ids.resourceId,
      {
        ...scoped,
        kind: "person",
        name: "Bruce Wayne",
        role: "Planner",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#76a5e7",
      },
    ],
    ["clients", ids.clientId, { ...scoped, name: "Wayne Enterprises", color: "#76a5e7" }],
    ["projects", ids.projectId, { ...scoped, clientId: ids.clientId, name: "Gotham Renewal", color: "#e776b8" }],
    ["activities", ids.activityId, { ...scoped, name: "City planning", kind: "project", projectId: ids.projectId }],
  ] as const) {
    const response = await request.post(`${AUTH_API}/api/batch`, {
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      data: { ops: [{ method: "PUT", table, id, row: { id, ...row } }] },
    });
    expect(response.status(), `seed ${table}/${id}`).toBe(200);
  }
  return { owner, ownerEmail, accountId, suffix, ...ids };
}

async function signIn(page: Page, email: string) {
  await page.clock.setFixedTime(new Date("2026-06-03T12:00:00"));
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
  await setZoom(page, 4);
  await goToSeedWeek(page);
}

async function planning(request: APIRequestContext, cookie: string, accountId: string) {
  const response = await request.get(`${AUTH_API}/api/accounts/${accountId}/planning`, { headers: { cookie } });
  expect(response.status()).toBe(200);
  return (await response.json()) as PlanningRead;
}

async function seedPrivateAbsence(request: APIRequestContext, data: Awaited<ReturnType<typeof scenario>>) {
  const id = `time-off-${data.suffix}`;
  const now = new Date().toISOString();
  const response = await request.post(`${AUTH_API}/api/batch`, {
    headers: { cookie: data.owner.cookie, "content-type": "application/json" },
    data: {
      ops: [
        {
          method: "PUT",
          table: "timeOff",
          id,
          row: {
            id,
            accountId: data.accountId,
            resourceId: data.resourceId,
            startDate: "2026-06-15",
            endDate: "2026-06-15",
            type: "sick",
            note: "Confidential appointment detail",
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
    },
  });
  expect(response.status(), `seed timeOff/${id}`).toBe(200);
  return id;
}

async function seedAttributedRepeatableActivity(
  request: APIRequestContext,
  data: Awaited<ReturnType<typeof scenario>>,
) {
  const allocationId = `allocation-${data.suffix}`;
  const now = new Date().toISOString();
  const scoped = { accountId: data.accountId, createdAt: now, updatedAt: now };
  const response = await request.post(`${AUTH_API}/api/batch`, {
    headers: { cookie: data.owner.cookie, "content-type": "application/json" },
    data: {
      ops: [
        {
          method: "PUT",
          table: "activities",
          id: data.activityId,
          row: {
            id: data.activityId,
            ...scoped,
            name: "City planning",
            kind: "repeatable",
            projectId: null,
            phaseId: null,
          },
        },
        {
          method: "PUT",
          table: "allocations",
          id: allocationId,
          row: {
            id: allocationId,
            ...scoped,
            resourceId: data.resourceId,
            activityId: data.activityId,
            projectId: data.projectId,
            startDate: "2026-06-01",
            endDate: "2026-06-01",
            hoursPerDay: 8,
            status: "confirmed",
            note: null,
            task: null,
            ignoreWeekends: null,
            seriesId: null,
          },
        },
      ],
    },
  });
  expect(response.status(), `seed attributed repeatable activity/${data.activityId}`).toBe(200);
  return { allocationId };
}

async function captureAccountTraffic(page: Page, accountId: string) {
  const traffic: Array<{ method: string; requestBody: string; responseBody: string }> = [];
  await page.route(`**/api/accounts/${accountId}/**`, async (route) => {
    const request = route.request();
    const response = await route.fetch();
    const responseBody = await response.text();
    traffic.push({
      method: request.method(),
      requestBody: request.postData() ?? "",
      responseBody,
    });
    await route.fulfill({ response, body: responseBody });
  });
  return traffic;
}

async function savedAllocations(page: Page, projectId: string, activityId: string) {
  await page.getByRole("button", { name: "Add allocation for Bruce Wayne" }).click();
  const dialog = page.getByRole("dialog", { name: "New allocation" });
  await selectShadOption(dialog.getByLabel("Project", { exact: true }), projectId);
  await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), activityId);
  await dialog.getByLabel("Start Date").fill("2026-06-01");
  await dialog.getByLabel("Days of work").fill("1");
  await dialog.getByRole("button", { name: "Save" }).click();
  return dialog;
}

async function peerUpdate(
  request: APIRequestContext,
  cookie: string,
  accountId: string,
  baseRevision: number,
  allocationId: string,
) {
  return request.patch(`${AUTH_API}/api/accounts/${accountId}/allocations/${allocationId}`, {
    headers: { cookie, "content-type": "application/json" },
    data: {
      mutationId: crypto.randomUUID(),
      baseRevision,
      intent: { operation: "allocation.update", id: allocationId, changes: { status: "tentative" } },
    },
  });
}

test("allocation dialog waits for the canonical server acknowledgement", async ({ page, request }) => {
  const data = await scenario(request);
  await signIn(page, data.ownerEmail);
  let committed!: () => void;
  let release!: () => void;
  const serverCommitted = new Promise<void>((resolve) => (committed = resolve));
  const responseReleased = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/accounts/${data.accountId}/allocations`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed();
    await responseReleased;
    await route.fulfill({ response });
  });

  const dialog = await savedAllocations(page, data.projectId, data.activityId);
  await serverCommitted;
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  const committedState = await planning(request, data.owner.cookie, data.accountId);
  expect(committedState.data.allocations).toHaveLength(1);
  release();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("allocation-bar").filter({ hasText: "City planning" })).toHaveCount(1);
  await page.unrouteAll();
});

test("a form keeps its captured revision and surfaces a 409 without replay after another writer", async ({
  page,
  request,
}) => {
  const data = await scenario(request);
  await signIn(page, data.ownerEmail);
  const initial = await planning(request, data.owner.cookie, data.accountId);
  const create = await request.post(`${AUTH_API}/api/accounts/${data.accountId}/allocations`, {
    headers: { cookie: data.owner.cookie, "content-type": "application/json" },
    data: {
      mutationId: crypto.randomUUID(),
      baseRevision: initial.revision,
      intent: {
        operation: "allocation.create",
        allocation: {
          id: crypto.randomUUID(),
          resourceId: data.resourceId,
          activityId: data.activityId,
          projectId: null,
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          hoursPerDay: 8,
          status: "confirmed",
        },
      },
    },
  });
  expect(create.status()).toBe(200);
  const allocationId = (
    (await create.json()) as { projection: { changed: { upserts: Array<{ row: { id: string } }> } } }
  ).projection.changed.upserts[0]?.row.id;
  expect(allocationId).toBeTruthy();
  await page.reload();
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
  await setZoom(page, 4);
  await goToSeedWeek(page);

  const openingState = await planning(request, data.owner.cookie, data.accountId);
  await page.getByTestId("allocation-bar").filter({ hasText: "City planning" }).click();
  const editor = page.getByRole("dialog", { name: "Edit allocation" });
  await editor.getByLabel("Note").fill("First writer edit");
  const beforePeer = await planning(request, data.owner.cookie, data.accountId);
  expect(beforePeer.revision).toBeGreaterThan(0);
  expect(beforePeer.revision).toBe(openingState.revision);
  const peer = await peerUpdate(request, data.owner.cookie, data.accountId, beforePeer.revision, allocationId!);
  expect(peer.status()).toBe(200);
  const afterPeer = await planning(request, data.owner.cookie, data.accountId);
  expect(afterPeer.revision).toBeGreaterThan(beforePeer.revision);
  const refresh = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/accounts/${data.accountId}/planning` &&
      response.request().method() === "GET",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refresh;

  let submissions = 0;
  let capturedBaseRevision: number | undefined;
  let responseStatus: number | undefined;
  await page.route(`**/api/accounts/${data.accountId}/allocations/${allocationId}`, async (route) => {
    submissions += 1;
    const payload = route.request().postDataJSON() as { baseRevision?: number };
    capturedBaseRevision = payload.baseRevision;
    const response = await route.fetch();
    responseStatus = response.status();
    await route.fulfill({ response });
  });
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /stale|changed|refresh|conflict/i })).toBeVisible();
  expect(submissions).toBe(1);
  expect(capturedBaseRevision).toBe(openingState.revision);
  expect(capturedBaseRevision).toBeLessThan(afterPeer.revision);
  expect(responseStatus).toBe(409);
  const final = await planning(request, data.owner.cookie, data.accountId);
  expect(final.data.allocations).toContainEqual(expect.objectContaining({ id: allocationId, status: "tentative" }));
  expect(final.data.allocations).not.toContainEqual(
    expect.objectContaining({ id: allocationId, note: "First writer edit" }),
  );
});

test("create Undo Redo Undo preserves the server allocation identity", async ({ page, request }) => {
  const data = await scenario(request);
  await signIn(page, data.ownerEmail);
  const dialog = await savedAllocations(page, data.projectId, data.activityId);
  await expect(dialog).toHaveCount(0);
  const created = (await planning(request, data.owner.cookie, data.accountId)).data.allocations[0];
  expect(created).toBeDefined();
  const undo = page.getByTestId("undo-button");
  const redo = page.getByTestId("redo-button");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect
    .poll(async () => (await planning(request, data.owner.cookie, data.accountId)).data.allocations)
    .toHaveLength(0);
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect
    .poll(async () => (await planning(request, data.owner.cookie, data.accountId)).data.allocations)
    .toContainEqual(expect.objectContaining({ id: created!.id }));
  await undo.click();
  await expect
    .poll(async () => (await planning(request, data.owner.cookie, data.accountId)).data.allocations)
    .toHaveLength(0);
  await page.reload();
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
  expect((await planning(request, data.owner.cookie, data.accountId)).data.allocations).toHaveLength(0);
});

test("source-free repeated creation is one atomic mutation and one Undo", async ({ page, request }) => {
  const data = await scenario(request);
  await signIn(page, data.ownerEmail);
  const before = await planning(request, data.owner.cookie, data.accountId);
  const groups: Array<{
    mutationId?: string;
    baseRevision?: number;
    intent?: { operation?: string; allocations?: Array<{ id?: string }> };
  }> = [];
  page.on("request", (outgoing) => {
    if (outgoing.method() === "POST" && outgoing.url().endsWith("/allocations/create-group"))
      groups.push(
        outgoing.postDataJSON() as {
          mutationId?: string;
          baseRevision?: number;
          intent?: { operation?: string; allocations?: Array<{ id?: string }> };
        },
      );
  });
  await page.getByRole("button", { name: "Add allocation for Bruce Wayne" }).click();
  const dialog = page.getByRole("dialog", { name: "New allocation" });
  await selectShadOption(dialog.getByLabel("Project", { exact: true }), data.projectId);
  await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), data.activityId);
  await dialog.getByLabel("Start Date").fill("2026-06-01");
  await dialog.getByLabel("Days of work").fill("1");
  await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "weekly");
  await dialog.getByLabel("Repeat until").fill("2026-06-15");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  const after = await planning(request, data.owner.cookie, data.accountId);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.data.allocations).toHaveLength(3);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.mutationId).toEqual(expect.any(String));
  expect(groups[0]?.baseRevision).toBe(before.revision);
  expect(groups[0]?.intent?.operation).toBe("allocation.createGroup");
  expect(groups[0]?.intent?.allocations).toHaveLength(3);
  await page.getByTestId("undo-button").click();
  await expect
    .poll(async () => (await planning(request, data.owner.cookie, data.accountId)).data.allocations)
    .toHaveLength(0);
});

test("a lost post-commit response is resolved by lookup without resending the create", async ({ page, request }) => {
  const data = await scenario(request);
  await signIn(page, data.ownerEmail);
  let commits = 0;
  let submissions = 0;
  let originalMutationId: string | undefined;
  const lookups: Array<{ url: string; mutationId: string | undefined }> = [];
  page.on("request", (outgoing) => {
    if (outgoing.method() === "GET" && outgoing.url().includes("/planning/mutations/")) {
      lookups.push({
        url: outgoing.url(),
        mutationId: new URL(outgoing.url()).pathname.split("/").at(-1),
      });
    }
  });
  await page.route(`**/api/accounts/${data.accountId}/allocations`, async (route) => {
    submissions += 1;
    const payload = route.request().postDataJSON() as { mutationId?: string };
    originalMutationId = payload.mutationId;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    commits += 1;
    await route.abort("failed");
  });
  const dialog = await savedAllocations(page, data.projectId, data.activityId);
  await expect
    .poll(async () => (await planning(request, data.owner.cookie, data.accountId)).data.allocations)
    .toHaveLength(1);
  await expect(dialog).toBeVisible();
  const recovery = dialog.getByTestId("planning-modal-recovery");
  await expect(recovery).toBeVisible();
  expect(lookups).toHaveLength(0);
  const checkSavedChange = recovery.getByRole("button", { name: "Check saved change" });
  const reconciledRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/accounts/${data.accountId}/planning` &&
      response.request().method() === "GET",
  );
  await checkSavedChange.click();
  await expect.poll(() => lookups.length).toBe(1);
  await expect.poll(() => submissions).toBe(1);
  await reconciledRead;
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
  await expect(page.getByTestId("allocation-bar").filter({ hasText: "City planning" })).toHaveCount(1);
  expect(commits).toBe(1);
  expect(submissions).toBe(1);
  expect(originalMutationId).toEqual(expect.any(String));
  expect(lookups).toEqual([
    expect.objectContaining({
      url: expect.stringContaining(`/planning/mutations/${originalMutationId}`),
      mutationId: originalMutationId,
    }),
  ]);
  await page.unrouteAll();
  const recovered = await planning(request, data.owner.cookie, data.accountId);
  expect(recovered.data.allocations).toHaveLength(1);
});

test("an editor deletes a private absence and Undo restores it without receiving its note", async ({
  page,
  request,
}) => {
  const data = await scenario(request);
  const editor = await signUpUser(`dick-grayson-plan-cache-${data.suffix}@capacitylens.dev`, "Dick Grayson");
  seedFixtureMember(data.accountId, editor.email, "editor");
  const timeOffId = await seedPrivateAbsence(request, data);
  const privateNote = "Confidential appointment detail";
  const ownerBefore = await planning(request, data.owner.cookie, data.accountId);
  expect(ownerBefore.data.timeOff).toContainEqual(expect.objectContaining({ id: timeOffId, note: privateNote }));

  const traffic = await captureAccountTraffic(page, data.accountId);
  await signIn(page, editor.email);
  const editorRead = await planning(request, editor.cookie, data.accountId);
  expect(editorRead.data.timeOff).toContainEqual(expect.objectContaining({ id: timeOffId, note: null }));
  expect(JSON.stringify(editorRead)).not.toContain(privateNote);

  await page.getByRole("link", { name: "Time off" }).click();
  const group = page
    .getByTestId("timeoff-group")
    .filter({ has: page.getByRole("heading", { name: "Bruce Wayne", exact: true }) });
  const row = group.getByTestId("timeoff-row");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: /^Edit / }).click();
  const editorDialog = page.getByRole("dialog", { name: "Edit time off" });
  await expect(editorDialog.getByLabel("Note", { exact: true })).toHaveCount(0);
  await editorDialog.getByRole("button", { name: "Cancel" }).click();

  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog", { name: "Delete time off?" }).getByRole("button", { name: "Delete" }).click();
  await expect
    .poll(async () => (await planning(request, editor.cookie, data.accountId)).data.timeOff.map(({ id }) => id))
    .not.toContain(timeOffId);

  await page.getByTestId("undo-button").click();
  await expect(row).toBeVisible();
  await expect
    .poll(async () => (await planning(request, editor.cookie, data.accountId)).data.timeOff.map(({ id }) => id))
    .toContain(timeOffId);
  const editorAfter = await planning(request, editor.cookie, data.accountId);
  expect(editorAfter.data.timeOff).toContainEqual(expect.objectContaining({ id: timeOffId, note: null }));
  expect(JSON.stringify(editorAfter)).not.toContain(privateNote);
  const ownerAfter = await planning(request, data.owner.cookie, data.accountId);
  expect(ownerAfter.data.timeOff).toContainEqual(expect.objectContaining({ id: timeOffId, note: privateNote }));

  const editorWrites = traffic
    .filter(({ method }) => method !== "GET")
    .map(
      ({ requestBody }) => JSON.parse(requestBody) as { intent?: { operation?: string; restorationGroupId?: string } },
    );
  expect(editorWrites.map(({ intent }) => intent?.operation)).toEqual(["timeOff.delete", "planning.restoreGroup"]);
  const restoreIntent = editorWrites[1]?.intent;
  expect(restoreIntent).toEqual({ operation: "planning.restoreGroup", restorationGroupId: expect.any(String) });
  expect(Object.keys(restoreIntent ?? {}).sort()).toEqual(["operation", "restorationGroupId"]);
  expect(JSON.stringify(traffic)).not.toContain(privateNote);
});

test("activity kind and project binding changes clear allocation attribution and restore through Undo/Redo", async ({
  page,
  request,
}) => {
  const data = await scenario(request);
  const { allocationId } = await seedAttributedRepeatableActivity(request, data);
  const traffic = await captureAccountTraffic(page, data.accountId);
  await signIn(page, data.ownerEmail);

  await page.getByRole("link", { name: "Activities" }).click();
  const row = page.getByTestId("activity-row").filter({ hasText: "City planning" });
  await row.getByRole("button", { name: /^Edit / }).click();
  const dialog = page.getByRole("dialog", { name: "Edit activity" });
  await dialog.getByRole("radio", { name: "Project-specific" }).click();
  await selectShadOption(dialog.getByLabel("Project", { exact: true }), data.projectId);
  await dialog.getByRole("button", { name: "Save" }).click();

  const expectState = async (expected: {
    kind: "project" | "repeatable";
    projectId: string | null;
    phaseId: string | null;
    allocationProjectId: string | null;
  }) => {
    await expect
      .poll(async () => {
        const read = await planning(request, data.owner.cookie, data.accountId);
        const activity = read.data.activities.find(({ id }) => id === data.activityId);
        const allocation = read.data.allocations.find(({ id }) => id === allocationId);
        return {
          activity: activity && { kind: activity.kind, projectId: activity.projectId, phaseId: activity.phaseId },
          allocationProjectId: allocation?.projectId,
        };
      })
      .toEqual({
        activity: { kind: expected.kind, projectId: expected.projectId, phaseId: expected.phaseId },
        allocationProjectId: expected.allocationProjectId,
      });
  };

  await expectState({
    kind: "project",
    projectId: data.projectId,
    phaseId: null,
    allocationProjectId: null,
  });
  await page.getByTestId("undo-button").click();
  await expectState({ kind: "repeatable", projectId: null, phaseId: null, allocationProjectId: data.projectId });
  await page.getByTestId("redo-button").click();
  await expectState({
    kind: "project",
    projectId: data.projectId,
    phaseId: null,
    allocationProjectId: null,
  });
  await page.getByTestId("undo-button").click();
  await expectState({ kind: "repeatable", projectId: null, phaseId: null, allocationProjectId: data.projectId });

  const editorWrites = traffic
    .filter(({ method }) => method !== "GET")
    .map(({ requestBody }) => JSON.parse(requestBody) as { intent?: { operation?: string } });
  expect(editorWrites.map(({ intent }) => intent?.operation)).toEqual([
    "catalogue.update",
    "planning.restoreGroup",
    "catalogue.update",
    "planning.restoreGroup",
  ]);
});
