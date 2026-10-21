import { test, expect } from "./fixtures";
import { AUTH_API } from "./authTestSupport";

test("sign-in preserves long Unicode credentials and normalizes a maximum-length email", async ({
  page,
  request,
}, testInfo) => {
  const localPart = `bruce.wayne.${Date.now()}-${testInfo.workerIndex}`.padEnd(64, "b");
  const domain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(56)}.test`;
  const email = `${localPart}@${domain}`;
  const password = "𠀀".repeat(128);
  expect(new TextEncoder().encode(email)).toHaveLength(254);
  const signup = await request.post(`${AUTH_API}/api/auth/sign-up/email`, {
    data: { email, password, name: "Bruce Wayne" },
  });
  expect(signup.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const emailInput = page.getByLabel("Email", { exact: true });
  const passwordInput = page.getByLabel("Password", { exact: true });
  await emailInput.pressSequentially(`  ${email.toUpperCase()}  `);
  expect((await emailInput.inputValue()).trim()).toBe(email.toUpperCase());

  const signInRequests: string[] = [];
  page.on("request", (event) => {
    if (new URL(event.url()).pathname === "/api/auth/sign-in/email") signInRequests.push(event.url());
  });
  await passwordInput.pressSequentially("x".repeat(257));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(passwordInput).toHaveValue("x".repeat(257));
  expect(signInRequests).toEqual([]);

  await passwordInput.fill("");
  await passwordInput.pressSequentially(password);
  await expect(passwordInput).toHaveValue(password);
  const response = page.waitForResponse((event) => new URL(event.url()).pathname === "/api/auth/sign-in/email");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await response).ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
  expect(signInRequests).toHaveLength(1);
});
