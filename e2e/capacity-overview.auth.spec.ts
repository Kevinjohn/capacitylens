import { expect, test } from "./fixtures";
import type { Page } from "./fixtures";
import {
  AUTH_PASSWORD,
  bootstrapOrg,
  seedFixtureMember,
  sendPlanningFixtureCommand,
  signUpUser,
} from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

const STAMP = Date.now();
const OWNER = `overview-owner-${STAMP}@capacitylens.dev`;
const VIEWER = `overview-viewer-${STAMP}@capacitylens.dev`;

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
}

test("the account access setting gates viewer navigation and direct routes", async ({ page, request }) => {
  const owner = await signUpUser(OWNER);
  const viewer = await signUpUser(VIEWER);
  const accountName = `Overview Studio ${STAMP}`;
  const accountId = await bootstrapOrg(request, owner.cookie, accountName);
  seedFixtureMember(accountId, viewer.email, "viewer");

  await signIn(page, VIEWER);
  await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  await expect(palette.getByText("Overview", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.history.pushState({}, "", "/overview");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();

  await sendPlanningFixtureCommand(
    request,
    owner.cookie,
    accountId,
    "settings",
    { operation: "settings.update", changes: { capacityOverviewAccess: "everyone" } },
    "patch",
  );
  await page.reload();
  const capacityOverviewLink = page.getByRole("link", { name: "Overview" });
  await expect(capacityOverviewLink).toBeVisible();
  await capacityOverviewLink.click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});
