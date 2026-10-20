import { expect, test } from "./fixtures";
import type { APIRequestContext, Locator, Page } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./authTestSupport";
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

type Allocation = { id: string; startDate: string; endDate: string; resourceId: string; activityId: string };

async function seedEntity(
  request: APIRequestContext,
  cookie: string,
  table: string,
  id: string,
  row: Record<string, unknown>,
) {
  const response = await request.post(`${AUTH_API}/api/batch`, {
    headers: { cookie, "content-type": "application/json" },
    data: { ops: [{ method: "PUT", table, id, row: { id, ...row } }] },
  });
  expect(response.status(), `seed ${table}/${id}`).toBe(200);
}

async function createScenario(request: APIRequestContext) {
  const suffix = `${STAMP}-${++scenarioNumber}`;
  const company = `Wayne Scheduler Studio ${suffix}`;
  const ownerEmail = `bruce-wayne-scheduler-${suffix}@capacitylens.dev`;
  const resourceId = `scheduler-person-${suffix}`;
  const clientId = `scheduler-client-${suffix}`;
  const projectId = `scheduler-project-${suffix}`;
  const activityId = `scheduler-activity-${suffix}`;
  const owner = await signUpUser(ownerEmail);
  const accountId = await bootstrapOrg(request, owner.cookie, company);
  const now = new Date().toISOString();
  const scoped = { accountId, createdAt: now, updatedAt: now };
  await seedEntity(request, owner.cookie, "resources", resourceId, {
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
  });
  await seedEntity(request, owner.cookie, "clients", clientId, {
    ...scoped,
    name: "Wayne Enterprises",
    color: "#76a5e7",
  });
  await seedEntity(request, owner.cookie, "projects", projectId, {
    ...scoped,
    clientId,
    name: "Gotham Renewal",
    color: "#e776b8",
  });
  await seedEntity(request, owner.cookie, "activities", activityId, {
    ...scoped,
    name: "City planning",
    kind: "project",
    projectId,
  });
  return { owner, accountId, company, ownerEmail, projectId, activityId };
}

async function signIn(page: Page, ownerEmail: string, company: string) {
  await page.clock.setFixedTime(new Date("2026-06-03T12:00:00"));
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: company, exact: true }).click();
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
  await setZoom(page, 4);
  await goToSeedWeek(page);
  await resetSchedulerScroll(page);
}

async function reloadScheduler(page: Page, company: string) {
  await page.reload();
  const companyButton = page.getByRole("button", { name: company, exact: true });
  const scheduleHeading = page.getByRole("heading", { name: "Schedule" });
  await companyButton.or(scheduleHeading).first().waitFor();
  if (await companyButton.isVisible().catch(() => false)) await companyButton.click();
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

async function dragByOneDay(page: Page, target: Locator, xOffset: number) {
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

test("authenticated scheduler create, move, resize and delete persist in SQLite", async ({ page, request }) => {
  const { owner, accountId, ownerEmail, company, projectId, activityId } = await createScenario(request);
  await signIn(page, ownerEmail, company);

  const bar = await createAllocation(page, projectId, activityId);
  await expect(bar).toHaveCount(1);
  const allocationId = await bar.getAttribute("data-alloc-id");
  expect(allocationId).toBeTruthy();
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).find(({ id }) => id === allocationId),
    )
    .toMatchObject({ startDate: "2026-06-01", endDate: "2026-06-01" });
  await reloadScheduler(page, company);
  await expect(bar).toBeVisible();

  await dragByOneDay(page, bar, await dayWidth(page));
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).find(({ id }) => id === allocationId),
    )
    .toMatchObject({ startDate: "2026-06-02", endDate: "2026-06-02" });
  await reloadScheduler(page, company);
  await expect(bar).toHaveAttribute("aria-label", /2 Jun to 2 Jun/);

  await dragByOneDay(page, bar.getByTestId("resize-end"), await dayWidth(page));
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).find(({ id }) => id === allocationId),
    )
    .toMatchObject({ startDate: "2026-06-02", endDate: "2026-06-03" });
  await reloadScheduler(page, company);
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
  await reloadScheduler(page, company);
  await expect(page.getByTestId("allocation-bar").filter({ hasText: "City planning" })).toHaveCount(0);
});

test("same-revision authenticated refresh preserves Undo and Redo in SQLite", async ({ page, request }) => {
  const { owner, accountId, ownerEmail, company, projectId, activityId } = await createScenario(request);
  await signIn(page, ownerEmail, company);
  const bar = await createAllocation(page, projectId, activityId);
  const allocationId = await bar.getAttribute("data-alloc-id");
  expect(allocationId).toBeTruthy();
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).some(({ id }) => id === allocationId),
    )
    .toBe(true);

  await page.clock.setFixedTime(new Date("2026-06-03T12:00:31"));
  const refresh = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/state" && response.request().method() === "GET",
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
  await reloadScheduler(page, company);
  await expect(page.getByTestId("allocation-bar").filter({ hasText: "City planning" })).toBeVisible();
});

test("a refused scheduler save is visible and does not persist", async ({ page, request }) => {
  const { owner, accountId, ownerEmail, company, projectId, activityId } = await createScenario(request);
  await signIn(page, ownerEmail, company);
  await page.route("**/api/batch", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Write refused" }) }),
  );

  const bar = await createAllocation(page, projectId, activityId);
  const allocationId = await bar.getAttribute("data-alloc-id");
  expect(allocationId).toBeTruthy();
  await expect(page.getByRole("alert").filter({ hasText: /save|persist|refus/i })).toBeVisible();
  await expect
    .poll(async () =>
      (await persistedAllocations(request, owner.cookie, accountId)).some(({ id }) => id === allocationId),
    )
    .toBe(false);
});
