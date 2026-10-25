import { test, expect } from "./fixtures";
import { AUTH_API as API, AUTH_PASSWORD as PASSWORD, printFixtureResetLink, signUpUser } from "./authTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// The E2E servers have no mail transport, so the operator command prints the reset link that would
// otherwise be emailed. The browser journey is the same: the link works without a session, the new
// password signs in, the old one stops working and the link cannot be used twice.

const NEW_PASSWORD = "fresh-password-reset-2026";

test("a reset link sets a new password once and retires the old one", async ({ page, request }) => {
  const email = `reset-${Date.now()}@capacitylens.dev`;
  await signUpUser(email, "Barbara Gordon");
  const resetPath = printFixtureResetLink(email);

  await page.goto(resetPath);
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  await page.getByTestId("reset-new-password").fill(NEW_PASSWORD);
  await page.getByTestId("reset-confirm-password").fill(NEW_PASSWORD);
  await page.getByTestId("reset-submit").click();
  await expect(page.getByTestId("reset-success")).toBeVisible();

  await page.getByRole("link", { name: "Go to sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The new identity has no company yet, so a signed-in session lands on an access screen naming it.
  const accessScreen = page.locator('main[data-testid^="access-"]');
  await expect(accessScreen).toBeVisible();
  await expect(accessScreen).toContainText(email);

  const headers = { "sec-fetch-site": "same-origin" };
  const oldSignIn = await request.post(`${API}/api/auth/sign-in`, { headers, data: { email, password: PASSWORD } });
  expect(oldSignIn.status()).toBe(401);
  const token = resetPath.split("/").filter(Boolean).at(-1);
  const reuse = await request.post(`${API}/api/auth/reset-password`, {
    headers,
    data: { token, newPassword: "second-password-reset-2026" },
  });
  expect(reuse.status()).toBe(400);
});
