import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./auth-helpers";
import { dismissIntroIfPresent, freezeBrowserDate, goToSeedWeek, setZoom } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const ACCOUNT = `Wayne Privacy Studio ${STAMP}`;
const OWNER = `clark-kent-${STAMP}@capacitylens.dev`;
const VIEWER = `kara-zor-el-${STAMP}@capacitylens.dev`;
const RESOURCE_ID = `privacy-person-${STAMP}`;
const TIME_OFF_ID = `privacy-timeoff-${STAMP}`;
const CLIENT_ID = `privacy-client-${STAMP}`;
const PROJECT_ID = `privacy-project-${STAMP}`;
const ACTIVITY_ID = `privacy-activity-${STAMP}`;
const ALLOCATION_ID = `privacy-allocation-${STAMP}`;
const PRIVATE_NOTE = "Owner-only medical appointment";
const REAL_CLIENT = "Kane Industries Acquisition";
const REAL_PROJECT = "Gotham Renewal";

async function putEntity(
  request: APIRequestContext,
  cookie: string,
  entity: string,
  id: string,
  data: Record<string, unknown>,
) {
  const response = await request.put(`${AUTH_API}/api/${entity}/${id}`, {
    headers: { cookie, "content-type": "application/json" },
    data: { id, ...data },
  });
  expect(response.status(), `seed ${entity}/${id}`).toBe(200);
}

async function seedPrivateScheduleEntities(
  request: APIRequestContext,
  cookie: string,
  scoped: { accountId: string; createdAt: string; updatedAt: string },
) {
  await putEntity(request, cookie, "clients", CLIENT_ID, {
    ...scoped,
    name: REAL_CLIENT,
    color: "#3b82f6",
    isPrivate: true,
    codeName: "Nightwing",
  });
  await putEntity(request, cookie, "projects", PROJECT_ID, {
    ...scoped,
    clientId: CLIENT_ID,
    name: REAL_PROJECT,
    color: "#ec4899",
    isPrivate: true,
    codeName: "Aurora",
  });
  await putEntity(request, cookie, "activities", ACTIVITY_ID, {
    ...scoped,
    name: "Private project delivery",
    kind: "project",
    projectId: PROJECT_ID,
  });
  await putEntity(request, cookie, "allocations", ALLOCATION_ID, {
    ...scoped,
    resourceId: RESOURCE_ID,
    activityId: ACTIVITY_ID,
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    hoursPerDay: 8,
    status: "confirmed",
  });
}

async function seedPrivacyScenario(request: APIRequestContext) {
  const owner = await signUpUser(OWNER);
  const viewer = await signUpUser(VIEWER);
  const accountId = await bootstrapOrg(request, owner.cookie, ACCOUNT);
  const seededAt = new Date().toISOString();
  const scoped = { accountId, createdAt: seededAt, updatedAt: seededAt };

  await putEntity(request, owner.cookie, "resources", RESOURCE_ID, {
    ...scoped,
    kind: "person",
    name: "Victor Stone",
    role: "Developer",
    employmentType: "permanent",
    engagement: "studio",
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#3b82f6",
  });
  await putEntity(request, owner.cookie, "timeOff", TIME_OFF_ID, {
    ...scoped,
    resourceId: RESOURCE_ID,
    startDate: "2026-06-10",
    endDate: "2026-06-11",
    type: "sick",
    note: PRIVATE_NOTE,
  });
  await seedPrivateScheduleEntities(request, owner.cookie, scoped);

  const invitation = await request.post(`${AUTH_API}/api/invites`, {
    headers: { cookie: owner.cookie },
    data: { accountId, role: "viewer" },
  });
  expect(invitation.status()).toBe(201);
  const token = ((await invitation.json()) as { token: string }).token;
  const accepted = await request.post(`${AUTH_API}/api/invites/${token}/accept`, {
    headers: { cookie: viewer.cookie },
  });
  expect(accepted.status()).toBe(200);
  return { owner, viewer };
}

async function signIn(page: Page, email: string) {
  await freezeBrowserDate(page);
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: ACCOUNT, exact: true }).click();
  await dismissIntroIfPresent(page, page.getByRole("heading", { name: "Schedule" }));
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
}

async function openPrivacyDrawer(page: Page) {
  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await setZoom(page, 1);
  await goToSeedWeek(page);
  const row = page.getByTestId("scheduler-row").filter({ hasText: "Victor Stone" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "View Victor Stone's schedule" }).click();
  return page.getByRole("dialog", { name: "Victor Stone's schedule" });
}

test("viewer cannot read personal time-off notes, while the owner can", async ({ page, request, context }) => {
  const { owner, viewer } = await seedPrivacyScenario(request);

  await signIn(page, viewer.email);
  const viewerSheet = await openPrivacyDrawer(page);
  await expect(viewerSheet).toBeVisible();
  await expect(viewerSheet).toContainText("Sick");
  await expect(viewerSheet).toContainText("10 – 11 Jun");
  await expect(viewerSheet).not.toContainText("2026");
  await expect(viewerSheet).not.toContainText(PRIVATE_NOTE);
  await expect(page.locator(`[title*="${PRIVATE_NOTE}"]`)).toHaveCount(0);
  await expect(viewerSheet).not.toContainText(REAL_CLIENT);
  await expect(viewerSheet).not.toContainText(REAL_PROJECT);
  await expect(viewerSheet).toContainText('"Nightwing"');
  await expect(viewerSheet).toContainText('"Aurora"');
  await expect(
    page.locator(
      `[aria-label*="${REAL_CLIENT}"], [title*="${REAL_CLIENT}"], [aria-label*="${REAL_PROJECT}"], [title*="${REAL_PROJECT}"]`,
    ),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(viewerSheet).toHaveCount(0);

  await context.clearCookies();
  await signIn(page, owner.email);
  const ownerSheet = await openPrivacyDrawer(page);
  await expect(ownerSheet).toBeVisible();
  await expect(ownerSheet).toContainText(PRIVATE_NOTE);
  await expect(ownerSheet).toContainText(REAL_CLIENT);
  await expect(ownerSheet).toContainText(REAL_PROJECT);
});
