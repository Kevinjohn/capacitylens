import { expect, test } from "./fixtures";
import { AUTH_PASSWORD, bootstrapOrg, seedFixtureMember, signUpUser } from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

const STAMP = Date.now();
const COMPANY = `Help Studio ${STAMP}`;
const USERS = {
  owner: `help-owner-${STAMP}@capacitylens.dev`,
  admin: `help-admin-${STAMP}@capacitylens.dev`,
  editor: `help-editor-${STAMP}@capacitylens.dev`,
  viewer: `help-viewer-${STAMP}@capacitylens.dev`,
};

test("every company role can open Help; a Viewer can start the read-only tour", async ({ page, request, context }) => {
  const owner = await signUpUser(USERS.owner);
  const accountId = await bootstrapOrg(request, owner.cookie, COMPANY);
  for (const role of ["admin", "editor", "viewer"] as const) {
    const member = await signUpUser(USERS[role]);
    seedFixtureMember(accountId, member.email, role);
  }

  for (const email of Object.values(USERS)) {
    await context.clearCookies();
    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(AUTH_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: COMPANY, exact: true }).click();
    await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));

    await page.getByRole("link", { name: "Help", exact: true }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page).toHaveTitle("Help · CapacityLens");
    await expect(page.getByTestId("show-tour")).toBeEnabled();
    if (email !== USERS.viewer) continue;

    await page.getByTestId("show-tour").click();
    await expect(page).toHaveURL(/\/$/);
    const viewerTour = page.locator(".driver-popover");
    await expect(viewerTour).toContainText("Viewer: Read the schedule");
    await expect(viewerTour).toContainText("1 of 2");
    await viewerTour.getByRole("button", { name: "Done" }).click();
  }
});
