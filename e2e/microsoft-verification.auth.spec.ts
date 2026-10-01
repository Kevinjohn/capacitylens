import { expect, test } from "./fixtures";

const SSO_BOOTSTRAP = {
  authMode: "sso-only",
  needsSetup: true,
  providers: [{ id: "microsoft", kind: "social", label: "Microsoft", experimental: false }],
};

for (const path of ["/verify-microsoft", "/verify-microsoft/"]) {
  test(`${path} is public and does not hydrate auth or tenant data`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.route("**/api/account/microsoft/status", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "pending" }) }),
    );

    await page.goto(`${path}#token=verification-proof`);
    await expect(page.getByRole("heading", { name: "Verify your Microsoft sign-in" })).toBeVisible();
    await expect(page.getByText("Check your email for a verification link.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm and continue" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
    await expect.poll(() => requests).toContain("/api/account/microsoft/status");
    expect(requests).not.toContain("/api/auth/me");
    expect(requests).not.toContain("/api/accounts");
    expect(requests).not.toContain("/api/state");
  });
}

test("keeps the proof in memory until the user confirms, then posts it to the confirmation endpoint", async ({
  page,
}) => {
  let confirmationBody: unknown;
  let confirmationCount = 0;
  await page.route("**/api/account/microsoft/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "pending" }) }),
  );
  await page.route("**/api/account/microsoft/confirm", async (route) => {
    confirmationCount += 1;
    confirmationBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: `${new URL(page.url()).origin}/__mock-microsoft-provider` }),
    });
  });
  await page.route("**/__mock-microsoft-provider", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "Microsoft provider handoff" }),
  );

  await page.goto("/verify-microsoft#token=fragment-proof");
  await expect(page.getByRole("button", { name: "Confirm and continue" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  expect(confirmationCount).toBe(0);

  await page.getByRole("button", { name: "Confirm and continue" }).click();
  await expect(page).toHaveURL(/\/__mock-microsoft-provider$/);
  expect(confirmationCount).toBe(1);
  expect(confirmationBody).toEqual({ token: "fragment-proof" });
});

test("recovers an approved request after reload without asking for the fragment token again", async ({ page }) => {
  let confirmationBody: unknown;
  await page.route("**/api/account/microsoft/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "approved" }) }),
  );
  await page.route("**/api/account/microsoft/confirm", async (route) => {
    confirmationBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: `${new URL(page.url()).origin}/__mock-microsoft-provider` }),
    });
  });
  await page.route("**/__mock-microsoft-provider", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "Microsoft provider handoff" }),
  );

  await page.goto("/verify-microsoft");
  await expect(page.getByText("Your email is verified.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Microsoft" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Microsoft" }).click();
  await expect(page).toHaveURL(/\/__mock-microsoft-provider$/);
  expect(confirmationBody).toEqual({});
});

test("offers a retry after a status failure and lets the user cancel the pending request", async ({ page }) => {
  let statusAttempts = 0;
  let cancelCount = 0;
  await page.route("**/api/account/microsoft/status", async (route) => {
    statusAttempts += 1;
    if (statusAttempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "pending" }) });
  });
  await page.route("**/api/account/microsoft/cancel", async (route) => {
    cancelCount += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/verify-microsoft#token=retry-proof");
  await expect(page.getByRole("alert")).toContainText("Could not check the verification request");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();
  await expect.poll(() => statusAttempts).toBe(2);

  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("The verification request was canceled.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and continue" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Return to sign in" })).toBeVisible();
  expect(cancelCount).toBe(1);
});
test("SSO first-owner setup asks for an email and starts Microsoft verification without a password", async ({
  page,
}) => {
  let startBody: Record<string, unknown> | undefined;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify(SSO_BOOTSTRAP) }),
  );
  await page.route("**/api/account/microsoft/start", async (route) => {
    startBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: `${new URL(page.url()).origin}/__mock-microsoft-provider` }),
    });
  });
  await page.route("**/__mock-microsoft-provider", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "Microsoft provider handoff" }),
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeVisible();

  await page.getByLabel(/email/i).fill("owner@example.com");
  await page.getByRole("button", { name: "Sign in with Microsoft" }).click();
  await expect(page).toHaveURL(/\/__mock-microsoft-provider$/);
  expect(startBody).toMatchObject({ purpose: "bootstrap", email: "owner@example.com" });
  expect(startBody).not.toHaveProperty("password");
});
