import { test, expect } from "./fixtures";
import type { APIRequestContext } from "./fixtures";
import { AUTH_API as API, AUTH_PASSWORD as PASSWORD, bootstrapOrg, signUpUser } from "./authTestSupport";
import { seedFixtureMember } from "./authDatabaseFixtures";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// Password resets use this run’s auth API lane. Reset links work without a session; after reset, the API rejects the old password.

const NEW_PASSWORD = "fresh-password-456";
// Unique per run so reruns against a reused auth server don't collide on existing users/accounts.
const STAMP = Date.now();
const OWNER = `reset-owner-${STAMP}@capacitylens.dev`;
const MEMBER = `reset-member-${STAMP}@capacitylens.dev`;

async function setupResetScenario(request: APIRequestContext) {
  const memberPromise = signUpUser(MEMBER);
  const ownerCookie = (await signUpUser(OWNER)).cookie;
  const accountId = await bootstrapOrg(request, ownerCookie, `Reset Studio ${STAMP}`);
  await memberPromise;
  seedFixtureMember(accountId, MEMBER, "editor");
}

test("admin mints a reset link in Team & access; the locked-out member sets a new password with it", async ({
  page,
  request,
}) => {
  await setupResetScenario(request);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: `Reset Studio ${STAMP}`, exact: true }).click();
  await page.getByRole("button", { name: "Got it" }).click();

  await page.getByRole("link", { name: "Team & access" }).click();
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  const memberRow = page.getByTestId("member-row").filter({ hasText: MEMBER });
  await expect(memberRow).toBeVisible();
  await memberRow.getByTestId("member-menu").click();
  await page.getByTestId("member-reset-password").click();
  await page
    .getByRole("alertdialog", { name: "Create password-reset link?" })
    .getByRole("button", { name: "Reset password" })
    .click();

  const linkEl = page.getByTestId("reset-link");
  await expect(linkEl).toContainText("/reset-password/");
  const resetLink = (await linkEl.textContent())?.trim() ?? "";

  await page.context().clearCookies();
  await page.goto(resetLink);
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  await page.getByTestId("reset-new-password").fill(NEW_PASSWORD);
  await page.getByTestId("reset-confirm-password").fill(NEW_PASSWORD);
  await page.getByTestId("reset-submit").click();
  await expect(page.getByTestId("reset-success")).toBeVisible();

  await page.getByRole("link", { name: "Go to sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(MEMBER);
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: `Reset Studio ${STAMP}`, exact: true })).toBeVisible();

  const oldSignIn = await request.post(`${API}/api/auth/sign-in/email`, {
    data: { email: MEMBER, password: PASSWORD },
  });
  expect(oldSignIn.status()).toBe(401);

  const reuseToken = resetLink.split("/reset-password/")[1];
  const reuse = await request.post(`${API}/api/auth/reset-password`, {
    data: { newPassword: "attacker-password-789", token: reuseToken },
  });
  expect(reuse.status()).toBe(400);
});
