import { expect, test } from "./fixtures";
import type { APIRequestContext, Page } from "./fixtures";
import {
  AUTH_PASSWORD,
  bootstrapOrg,
  createFixturePerson,
  seedFixtureMember,
  sendPlanningFixtureCommand,
  signUpUser,
} from "./authTestSupport";
import { waitForAppLanding, freezeBrowserDate, goToSeedWeek, setZoom } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const ACCOUNT = `Wayne Privacy Studio ${STAMP}`;
const OWNER = `clark-kent-${STAMP}@capacitylens.dev`;
const VIEWER = `kara-zor-el-${STAMP}@capacitylens.dev`;
const RESOURCE_ID = crypto.randomUUID();
const TIME_OFF_ID = crypto.randomUUID();
const CLIENT_ID = crypto.randomUUID();
const PROJECT_ID = crypto.randomUUID();
const ACTIVITY_ID = crypto.randomUUID();
const ALLOCATION_ID = crypto.randomUUID();
const PRIVATE_NOTE = "Owner-only medical appointment";
const REAL_CLIENT = "Kane Industries Acquisition";
const REAL_PROJECT = "Gotham Renewal";

async function seedPrivacyScenario(request: APIRequestContext) {
  const owner = await signUpUser(OWNER);
  const viewer = await signUpUser(VIEWER);
  const accountId = await bootstrapOrg(request, owner.cookie, ACCOUNT);
  await createFixturePerson(request, owner.cookie, accountId, {
    id: RESOURCE_ID,
    name: "Victor Stone",
    role: "Developer",
  });
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "time-off", {
    operation: "timeOff.create",
    timeOff: {
      id: TIME_OFF_ID,
      resourceId: RESOURCE_ID,
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      type: "sick",
      note: PRIVATE_NOTE,
    },
  });
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "clients", {
    operation: "catalogue.create",
    entity: {
      entity: "clients",
      id: CLIENT_ID,
      fields: { name: REAL_CLIENT, color: "#76a5e7", isPrivate: true, codeName: "Nightwing" },
    },
  });
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "projects", {
    operation: "catalogue.create",
    entity: {
      entity: "projects",
      id: PROJECT_ID,
      fields: { clientId: CLIENT_ID, name: REAL_PROJECT, color: "#e776b8", isPrivate: true, codeName: "Aurora" },
    },
  });
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "activities", {
    operation: "catalogue.create",
    entity: {
      entity: "activities",
      id: ACTIVITY_ID,
      fields: { name: "Private project delivery", kind: "project", projectId: PROJECT_ID, phaseId: null },
    },
  });
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "allocations", {
    operation: "allocation.create",
    allocation: {
      id: ALLOCATION_ID,
      resourceId: RESOURCE_ID,
      activityId: ACTIVITY_ID,
      projectId: null,
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    },
  });

  seedFixtureMember(accountId, viewer.email, "viewer");
  return { owner, viewer };
}

async function signIn(page: Page, email: string) {
  await freezeBrowserDate(page);
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
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
