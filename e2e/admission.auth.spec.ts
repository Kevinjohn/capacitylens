import { test, expect } from "./fixtures";
import {
  AUTH_API as API,
  AUTH_PASSWORD as PASSWORD,
  bootstrapOrg,
  confirmFixtureAddress,
  signUpUser,
} from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const OWNER = `admission-owner-${STAMP}@capacitylens.dev`;
const PERSON = `admission-person-${STAMP}@capacitylens.dev`;

test("a confirmed person asks for access, an Owner approves it, and the person joins as Viewer", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const owner = await signUpUser(OWNER);
  await bootstrapOrg(request, owner.cookie, `Admission Studio ${STAMP}`);
  const signup = await request.post(`${API}/api/auth/sign-up`, {
    data: { email: PERSON, password: PASSWORD, name: "Barry Allen" },
    headers: { "sec-fetch-site": "same-origin" },
  });
  expect(signup.status()).toBe(201);
  confirmFixtureAddress(PERSON);

  await page.goto("/");
  await page.getByLabel("Email").fill(PERSON);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  const admission = page.getByTestId("access-admission");
  await expect(admission).toBeVisible();
  await admission.getByTestId("access-request-admission").click();
  await expect(admission).toContainText("Your request has been sent");

  const ownerContext = await browser.newContext({ reducedMotion: "reduce" });
  try {
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto("/");
    await ownerPage.getByLabel("Email").fill(OWNER);
    await ownerPage.getByLabel("Password").fill(PASSWORD);
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await waitForAppLanding(ownerPage, ownerPage.locator("#main"));
    await ownerPage.getByRole("link", { name: "Team & access" }).click();
    const waiting = ownerPage.getByTestId("admission-request").filter({ hasText: PERSON });
    await expect(waiting).toBeVisible();
    await waiting.getByTestId("admission-approve").click();
    await expect(waiting).toHaveCount(0);
  } finally {
    await ownerContext.close();
  }

  await admission.getByRole("button", { name: "Check again" }).click();
  const membership = page.getByTestId("access-membership");
  await expect(membership).toBeVisible();
  await membership.getByTestId("access-join-company").click();
  await waitForAppLanding(page, page.locator("#main"));
  await page.getByRole("link", { name: "Team & access" }).click();
  await expect(page.getByTestId("current-access")).toContainText("Viewer");
});
