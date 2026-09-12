import { expect, test, type Page } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./auth-helpers";
import { dismissIntroIfPresent } from "./helpers";

const STAMP = Date.now();
const OWNER = `overview-owner-${STAMP}@capacitylens.dev`;
const VIEWER = `overview-viewer-${STAMP}@capacitylens.dev`;

async function signIn(page: Page, email: string, accountName: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: accountName, exact: true }).click();
  await dismissIntroIfPresent(page, page.getByRole("heading", { name: "Schedule" }));
}

test("the account access setting gates viewer navigation and direct routes", async ({ page, request }) => {
  const owner = await signUpUser(OWNER);
  const viewer = await signUpUser(VIEWER);
  const accountName = `Overview Studio ${STAMP}`;
  const accountId = await bootstrapOrg(request, owner.cookie, accountName);
  const invitation = await request.post(`${AUTH_API}/api/invites`, {
    headers: { cookie: owner.cookie },
    data: { accountId, role: "viewer" },
  });
  expect(invitation.status()).toBe(201);
  const token = (await invitation.json()).token as string;
  const accepted = await request.post(`${AUTH_API}/api/invites/${token}/accept`, {
    headers: { cookie: viewer.cookie },
  });
  expect(accepted.status()).toBe(200);

  await signIn(page, VIEWER, accountName);
  await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
  await page.evaluate(() => {
    window.history.pushState({}, "", "/overview");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();

  const enabled = await request.patch(`${AUTH_API}/api/accounts/${accountId}`, {
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    data: { capacityOverviewAccess: "everyone" },
  });
  expect(enabled.status()).toBe(200);
  await page.reload();
  const capacityOverviewLink = page.getByRole("link", { name: "Overview" });
  await expect(capacityOverviewLink).toBeVisible();
  await capacityOverviewLink.click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});
