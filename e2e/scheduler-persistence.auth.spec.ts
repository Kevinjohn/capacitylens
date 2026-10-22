import { expect, test } from "./fixtures";
import type { APIRequestContext, Locator, Page } from "./fixtures";
import {
  AUTH_API,
  AUTH_PASSWORD,
  bootstrapOrg,
  createFixturePerson,
  revokeFixtureSessions,
  sendPlanningFixtureCommand,
  signUpUser,
} from "./authTestSupport";
import {
  boundingBoxOrThrow,
  goToSeedWeek,
  resetSchedulerScroll,
  selectShadOption,
  setZoom,
  waitForAppLanding,
} from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
let scenarioNumber = 0;

type Allocation = {
  id: string;
  startDate: string;
  endDate: string;
  resourceId: string;
  activityId: string;
  seriesId?: string | null;
};

async function createScenario(request: APIRequestContext) {
  const suffix = `${STAMP}-${++scenarioNumber}`;
  const company = `Wayne Scheduler Studio ${suffix}`;
  const ownerEmail = `bruce-wayne-scheduler-${suffix}@capacitylens.dev`;
  const resourceId = crypto.randomUUID();
  const secondResourceId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const owner = await signUpUser(ownerEmail);
  const accountId = await bootstrapOrg(request, owner.cookie, company);
  await createFixturePerson(request, owner.cookie, accountId, { id: resourceId, name: "Bruce Wayne", role: "Planner" });
  await createFixturePerson(request, owner.cookie, accountId, {
    id: secondResourceId,
    name: "Clark Kent",
    role: "Planner",
  });
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "clients", {
    operation: "catalogue.create",
    entity: { entity: "clients", id: clientId, fields: { name: "Wayne Enterprises", color: "#76a5e7" } },
  });
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "projects", {
    operation: "catalogue.create",
    entity: { entity: "projects", id: projectId, fields: { clientId, name: "Gotham Renewal", color: "#e776b8" } },
  });
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "activities", {
    operation: "catalogue.create",
    entity: {
      entity: "activities",
      id: activityId,
      fields: { name: "City planning", kind: "project", projectId, phaseId: null },
    },
  });
  return { owner, accountId, ownerEmail, resourceId, secondResourceId, projectId, activityId };
}

async function signIn(page: Page, ownerEmail: string) {
  await page.clock.setFixedTime(new Date("2026-06-03T12:00:00"));
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
  await setZoom(page, 4);
  await goToSeedWeek(page);
  await resetSchedulerScroll(page);
}

async function reloadScheduler(page: Page) {
  await page.reload();
  const scheduleHeading = page.getByRole("heading", { name: "Schedule" });
  await waitForAppLanding(page, scheduleHeading);
  await setZoom(page, 4);
  await goToSeedWeek(page);
}

async function dayWidth(page: Page) {
  return page.getByTestId("scheduler-day-tier").evaluate((tier) => {
    const monday = tier.querySelector<HTMLElement>('[data-date="2026-06-01"]');
    const tuesday = tier.querySelector<HTMLElement>('[data-date="2026-06-02"]');
    if (!monday || !tuesday) throw new Error("Expected adjacent seed-week day columns");
    return tuesday.getBoundingClientRect().left - monday.getBoundingClientRect().left;
  });
}

// Sign-in resets the grid to scrollLeft 0, which can leave the seed-week bar outside the viewport.
async function dragByOneDay(page: Page, target: Locator, xOffset: number) {
  await target.scrollIntoViewIfNeeded();
  const box = await boundingBoxOrThrow(target);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + xOffset, y, { steps: 8 });
  await page.mouse.up();
}

async function persistedAllocations(request: APIRequestContext, cookie: string, accountId: string) {
  const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, { headers: { cookie } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { allocations: Allocation[] }).allocations;
}

async function createAllocation(page: Page, projectId: string, activityId: string) {
  await page.getByRole("button", { name: "Add allocation for Bruce Wayne" }).click();
  const dialog = page.getByRole("dialog", { name: "New allocation" });
  await selectShadOption(dialog.getByLabel("Project", { exact: true }), projectId);
  await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), activityId);
  await dialog.getByLabel("Start Date").fill("2026-06-01");
  await dialog.getByLabel("Days of work").fill("1");
  await dialog.getByRole("button", { name: "Save" }).click();
  return page.getByTestId("allocation-bar").filter({ hasText: "City planning" });
}

type RecordedRequest = { method: string; path: string };

function isPlanningRead(accountId: string, method: string, url: string) {
  return method === "GET" && new URL(url).pathname === `/api/accounts/${accountId}/planning`;
}

// Typed allocation writes and the restoration that undoes a delete; the canonical GET is excluded.
function isTypedAllocationWrite(accountId: string, { method, path }: RecordedRequest) {
  return (
    method !== "GET" &&
    (path.startsWith(`/api/accounts/${accountId}/allocations`) ||
      path === `/api/accounts/${accountId}/planning/restore-group`)
  );
}

/** Records page requests after fixture seeding, so only scheduler gestures are counted. */
function recordRequests(page: Page) {
  const requests: RecordedRequest[] = [];
  page.on("request", (request) => requests.push({ method: request.method(), path: new URL(request.url()).pathname }));
  return requests;
}

async function allocationFrom(request: APIRequestContext, cookie: string, accountId: string, id: string) {
  return (await persistedAllocations(request, cookie, accountId)).find((allocation) => allocation.id === id);
}

/** One gesture sends exactly one typed planning request and no legacy batch. */
async function expectOneTypedWrite(
  page: Page,
  accountId: string,
  requests: RecordedRequest[],
  gesture: () => Promise<void>,
  persisted: () => Promise<void>,
) {
  const start = requests.length;
  const written = page.waitForResponse((response) =>
    isTypedAllocationWrite(accountId, {
      method: response.request().method(),
      path: new URL(response.url()).pathname,
    }),
  );
  await gesture();
  expect((await written).ok()).toBe(true);
  await persisted();
  const sent = requests.slice(start);
  expect(sent.filter((request) => isTypedAllocationWrite(accountId, request))).toHaveLength(1);
  expect(sent.filter(({ path }) => path === "/api/batch")).toEqual([]);
}

/** Applies one gesture, then Undo and Redo, each as one typed write with the expected stored projection. */
async function gestureUndoRedo<T>(
  input: { page: Page; accountId: string; requests: RecordedRequest[]; stored: () => Promise<Allocation[]> },
  gesture: () => Promise<void>,
  project: (allocations: Allocation[]) => T,
  before: T,
  after: T,
) {
  const { page, accountId, requests, stored } = input;
  const settled = (expected: T) => async () => {
    await expect.poll(async () => project(await stored())).toEqual(expected);
  };
  await expectOneTypedWrite(page, accountId, requests, gesture, settled(after));
  const undo = page.getByTestId("undo-button");
  await expect(undo).toBeEnabled();
  await expectOneTypedWrite(page, accountId, requests, () => undo.click(), settled(before));
  const redo = page.getByTestId("redo-button");
  await expect(redo).toBeEnabled();
  await expectOneTypedWrite(page, accountId, requests, () => redo.click(), settled(after));
}

async function dragToLane(page: Page, target: Locator, lane: Locator) {
  // Scroll the lane first: scrolling the wide lane can move the bar, so the bar is scrolled last
  // and both boxes are read afterwards.
  await lane.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const box = await boundingBoxOrThrow(target);
  const laneBox = await boundingBoxOrThrow(lane);
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, laneBox.y + laneBox.height / 2, { steps: 10 });
  await page.mouse.up();
}

test("authenticated scheduler create, move, resize and delete persist in SQLite", async ({ page, request }) => {
  const { owner, accountId, ownerEmail, projectId, activityId } = await createScenario(request);
  await signIn(page, ownerEmail);

  const bar = await createAllocation(page, projectId, activityId);
  await expect(bar).toHaveCount(1);
  const allocationId = await bar.getAttribute("data-alloc-id");
  expect(allocationId).toBeTruthy();
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).find(({ id }) => id === allocationId),
    )
    .toMatchObject({ startDate: "2026-06-01", endDate: "2026-06-01" });
  await reloadScheduler(page);
  await expect(bar).toBeVisible();

  await dragByOneDay(page, bar, await dayWidth(page));
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).find(({ id }) => id === allocationId),
    )
    .toMatchObject({ startDate: "2026-06-02", endDate: "2026-06-02" });
  await reloadScheduler(page);
  await expect(bar).toHaveAttribute("aria-label", /2 Jun to 2 Jun/);

  await dragByOneDay(page, bar.getByTestId("resize-end"), await dayWidth(page));
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).find(({ id }) => id === allocationId),
    )
    .toMatchObject({ startDate: "2026-06-02", endDate: "2026-06-03" });
  await reloadScheduler(page);
  await expect(bar).toHaveAttribute("aria-label", /2 Jun to 3 Jun/);

  await bar.click();
  const editor = page.getByRole("dialog", { name: "Edit allocation" });
  await editor.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog", { name: "Delete allocation?" }).getByRole("button", { name: "Delete" }).click();
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).some(({ id }) => id === allocationId),
    )
    .toBe(false);
  await reloadScheduler(page);
  await expect(page.getByTestId("allocation-bar").filter({ hasText: "City planning" })).toHaveCount(0);
});

test("same-revision authenticated refresh preserves Undo and Redo in SQLite", async ({ page, request }) => {
  const { owner, accountId, ownerEmail, projectId, activityId } = await createScenario(request);
  await signIn(page, ownerEmail);
  const bar = await createAllocation(page, projectId, activityId);
  const allocationId = await bar.getAttribute("data-alloc-id");
  expect(allocationId).toBeTruthy();
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).some(({ id }) => id === allocationId),
    )
    .toBe(true);

  await page.clock.setFixedTime(new Date("2026-06-03T12:00:31"));
  const refresh = page.waitForResponse((response) =>
    isPlanningRead(accountId, response.request().method(), response.url()),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const refreshResponse = await refresh;
  await refreshResponse.finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  const undo = page.getByTestId("undo-button");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).some(({ id }) => id === allocationId),
    )
    .toBe(false);

  const redo = page.getByTestId("redo-button");
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).some(({ id }) => id === allocationId),
    )
    .toBe(true);
  await reloadScheduler(page);
  await expect(page.getByTestId("allocation-bar").filter({ hasText: "City planning" })).toBeVisible();
});

test("a refused scheduler write keeps the schedule and history visible and does not persist", async ({
  page,
  request,
}) => {
  const { owner, accountId, ownerEmail, projectId, activityId } = await createScenario(request);
  await signIn(page, ownerEmail);
  const bar = await createAllocation(page, projectId, activityId);
  const allocationId = await bar.getAttribute("data-alloc-id");
  expect(allocationId).toBeTruthy();
  await expect
    .poll(async () => (await allocationFrom(request, owner.cookie, accountId, allocationId!))?.startDate)
    .toBe("2026-06-01");
  const undo = page.getByTestId("undo-button");
  await expect(undo).toBeEnabled();

  await page.route(`**/api/accounts/${accountId}/allocations/**`, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "Write refused", code: "authorization_denied" }),
    }),
  );
  const requests = recordRequests(page);
  const refused = page.waitForResponse((response) =>
    isTypedAllocationWrite(accountId, {
      method: response.request().method(),
      path: new URL(response.url()).pathname,
    }),
  );
  await dragByOneDay(page, bar, await dayWidth(page));
  expect((await refused).status()).toBe(403);

  // K2: a 403 keeps readable rows and page-local history and shows the refusal.
  await expect(page.getByRole("alert").filter({ hasText: /save|persist|refus/i })).toBeVisible();
  await expect(bar).toHaveAttribute("aria-label", /1 Jun to 1 Jun/);
  await expect(undo).toBeEnabled();
  expect(requests.filter(({ path }) => path === "/api/batch")).toEqual([]);
  expect(await allocationFrom(request, owner.cookie, accountId, allocationId!)).toMatchObject({
    startDate: "2026-06-01",
    endDate: "2026-06-01",
  });
});

test("each scheduler gesture is one typed write with Undo and Redo, and reload clears history", async ({
  page,
  request,
}) => {
  const { owner, accountId, ownerEmail, resourceId, secondResourceId, projectId, activityId } =
    await createScenario(request);
  await signIn(page, ownerEmail);
  const requests = recordRequests(page);
  const stored = () => persistedAllocations(request, owner.cookie, accountId);
  const harness = { page, accountId, requests, stored };
  const cityPlanning = page.getByTestId("allocation-bar").filter({ hasText: "City planning" });
  const count = (allocations: Allocation[]) => allocations.length;

  await gestureUndoRedo(
    harness,
    async () => {
      await createAllocation(page, projectId, activityId);
    },
    count,
    0,
    1,
  );
  const allocationId = await cityPlanning.getAttribute("data-alloc-id");
  expect(allocationId).toBeTruthy();
  const bar = page.locator(`[data-testid="allocation-bar"][data-alloc-id="${allocationId}"]`);
  const placement = (allocations: Allocation[]) => {
    const allocation = allocations.find(({ id }) => id === allocationId);
    return allocation && [allocation.startDate, allocation.endDate, allocation.resourceId];
  };

  const width = await dayWidth(page);
  await gestureUndoRedo(
    harness,
    () => dragByOneDay(page, bar, width),
    placement,
    ["2026-06-01", "2026-06-01", resourceId],
    ["2026-06-02", "2026-06-02", resourceId],
  );
  await gestureUndoRedo(
    harness,
    () => dragByOneDay(page, bar.getByTestId("resize-end"), width),
    placement,
    ["2026-06-02", "2026-06-02", resourceId],
    ["2026-06-02", "2026-06-03", resourceId],
  );
  await gestureUndoRedo(
    harness,
    () => dragToLane(page, bar, page.locator(`[data-resource-id="${secondResourceId}"]`)),
    placement,
    ["2026-06-02", "2026-06-03", resourceId],
    ["2026-06-02", "2026-06-03", secondResourceId],
  );
  await gestureUndoRedo(
    harness,
    async () => {
      await bar.click();
      await page.getByRole("dialog", { name: "Edit allocation" }).getByRole("button", { name: "Duplicate" }).click();
    },
    count,
    1,
    2,
  );
  // The New allocation dialog's repeat creates a new repeated set (allocation.createGroup).
  await gestureUndoRedo(
    harness,
    async () => {
      await page.getByRole("button", { name: "Add allocation for Bruce Wayne" }).click();
      const dialog = page.getByRole("dialog", { name: "New allocation" });
      await selectShadOption(dialog.getByLabel("Project", { exact: true }), projectId);
      await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), activityId);
      await dialog.getByLabel("Start Date").fill("2026-06-08");
      await dialog.getByLabel("Days of work").fill("1");
      await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "weekly");
      await dialog.getByLabel("Repeat until").fill("2026-06-22");
      await dialog.getByRole("button", { name: "Save" }).click();
    },
    count,
    2,
    5,
  );
  await gestureUndoRedo(
    harness,
    async () => {
      await bar.click();
      await page.getByRole("dialog", { name: "Edit allocation" }).getByRole("button", { name: "Delete" }).click();
      await page
        .getByRole("alertdialog", { name: "Delete allocation?" })
        .getByRole("button", { name: "Delete" })
        .click();
    },
    (allocations) => allocations.some(({ id }) => id === allocationId),
    true,
    false,
  );
  expect(requests.filter(({ path }) => path === "/api/batch")).toEqual([]);

  await reloadScheduler(page);
  await expect(bar).toHaveCount(0);
  await expect(cityPlanning.first()).toBeVisible();
  expect(await stored()).toHaveLength(4);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
  await expect(page.getByTestId("redo-button")).toBeDisabled();
});

test("a weekly repeat persists all 14 occurrences as one series through one typed write", async ({ page, request }) => {
  const { owner, accountId, ownerEmail, resourceId, projectId, activityId } = await createScenario(request);
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "allocations", {
    operation: "allocation.create",
    allocation: {
      id: crypto.randomUUID(),
      resourceId,
      activityId,
      projectId: null,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    },
  });
  const stored = () => persistedAllocations(request, owner.cookie, accountId);
  const baseline = await stored();
  expect(baseline).toHaveLength(1);
  await signIn(page, ownerEmail);
  const requests = recordRequests(page);
  const added = (allocations: Allocation[]) => allocations.filter(({ id }) => !baseline.some((row) => row.id === id));
  const wednesdays = [
    "2026-06-10",
    "2026-06-17",
    "2026-06-24",
    "2026-07-01",
    "2026-07-08",
    "2026-07-15",
    "2026-07-22",
    "2026-07-29",
    "2026-08-05",
    "2026-08-12",
    "2026-08-19",
    "2026-08-26",
    "2026-09-02",
    "2026-09-09",
  ];
  const expectRepeatPersisted = async () => {
    const allocations = await stored();
    expect(allocations.filter(({ id }) => baseline.some((row) => row.id === id))).toEqual(baseline);
    const repeated = added(allocations).sort((a, b) => a.id.localeCompare(b.id));
    expect(repeated.map(({ startDate, endDate }) => [startDate, endDate]).sort()).toEqual(
      wednesdays.map((date) => [date, date]),
    );
    const seriesId = repeated[0]?.seriesId;
    expect(seriesId).toEqual(expect.stringMatching(/./));
    expect(repeated.every((row) => row.seriesId === seriesId)).toBe(true);
    return repeated;
  };

  await expectOneTypedWrite(
    page,
    accountId,
    requests,
    async () => {
      await page.getByRole("button", { name: "Add allocation for Bruce Wayne" }).click();
      const dialog = page.getByRole("dialog", { name: "New allocation" });
      await selectShadOption(dialog.getByLabel("Project", { exact: true }), projectId);
      await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), activityId);
      await dialog.getByLabel("Start Date").fill("2026-06-10");
      await dialog.getByLabel("Days of work").fill("1");
      await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "weekly");
      await dialog.getByLabel("Repeat until").fill("2026-09-10");
      await dialog.getByRole("button", { name: "Save" }).click();
    },
    async () => {
      await expect.poll(async () => added(await stored()).length).toBe(14);
    },
  );
  const repeated = await expectRepeatPersisted();

  await reloadScheduler(page);
  expect(await expectRepeatPersisted()).toEqual(repeated);
});

test("a stale-revision scheduler write shows server state without a toast or history entry", async ({
  page,
  request,
}) => {
  const { owner, accountId, ownerEmail, projectId, activityId } = await createScenario(request);
  await signIn(page, ownerEmail);
  const bar = await createAllocation(page, projectId, activityId);
  const allocationId = await bar.getAttribute("data-alloc-id");
  expect(allocationId).toBeTruthy();
  await expect
    .poll(async () => (await allocationFrom(request, owner.cookie, accountId, allocationId!))?.startDate)
    .toBe("2026-06-01");
  await expect(page.getByTestId("undo-button")).toBeEnabled();

  // Another writer advances the server revision without this page refetching.
  const planning = await request.get(`${AUTH_API}/api/accounts/${accountId}/planning`, {
    headers: { cookie: owner.cookie },
  });
  expect(planning.status()).toBe(200);
  const { revision } = (await planning.json()) as { revision: number };
  const external = await request.patch(`${AUTH_API}/api/accounts/${accountId}/allocations/${allocationId}`, {
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    data: {
      mutationId: crypto.randomUUID(),
      baseRevision: revision,
      intent: {
        operation: "allocation.update",
        id: allocationId,
        changes: { startDate: "2026-06-04", endDate: "2026-06-04" },
      },
    },
  });
  expect(external.status()).toBe(200);

  const conflict = page.waitForResponse((response) =>
    isTypedAllocationWrite(accountId, {
      method: response.request().method(),
      path: new URL(response.url()).pathname,
    }),
  );
  await dragByOneDay(page, bar, await dayWidth(page));
  expect((await conflict).status()).toBe(409);

  await expect(bar).toHaveAttribute("aria-label", /4 Jun to 4 Jun/);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
  await expect(page.getByTestId("redo-button")).toBeDisabled();
  expect(await allocationFrom(request, owner.cookie, accountId, allocationId!)).toMatchObject({
    startDate: "2026-06-04",
    endDate: "2026-06-04",
  });
});

test("an ended session (401) clears the scheduler cache and history", async ({ page, request }) => {
  const { owner, accountId, ownerEmail, projectId, activityId } = await createScenario(request);
  await signIn(page, ownerEmail);
  const bar = await createAllocation(page, projectId, activityId);
  const allocationId = await bar.getAttribute("data-alloc-id");
  expect(allocationId).toBeTruthy();
  await expect
    .poll(async () => (await allocationFrom(request, owner.cookie, accountId, allocationId!))?.startDate)
    .toBe("2026-06-01");
  await expect(page.getByTestId("undo-button")).toBeEnabled();

  revokeFixtureSessions(ownerEmail);
  await page.context().clearCookies();
  expect((await page.request.get(`${AUTH_API}/api/accounts/${accountId}/planning`)).status()).toBe(401);
  await page.clock.setFixedTime(new Date("2026-06-03T12:00:31"));
  // A late response may reissue a cookie, but the server-side session is revoked.
  const read = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/me");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect((await read).status()).toBe(401);

  await expect(page.getByTestId("allocation-bar")).toHaveCount(0);
  await expect(page.locator('[data-testid="undo-button"]:enabled')).toHaveCount(0);
  await expect(page.locator('[data-testid="redo-button"]:enabled')).toHaveCount(0);
});
