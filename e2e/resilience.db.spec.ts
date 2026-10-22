import { test, expect } from "./dbFixtures";
import { API, resetServer, serverState, requireStateRows } from "./serverTestState";
import { failRequestsUntilReleased } from "./failRequestsUntilReleased";
import { waitForAppLanding, freezeBrowserDate, openApp } from "./browserTestSupport";

function registerBeforeEachHooks() {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request: request, withSeed: true });
  });
}

function registerInitialStateFailurePreventsEditingTest() {
  test("an initial state failure prevents editing and Retry recovers the real server data", async ({ page }) => {
    const stateFailure = await failRequestsUntilReleased(page, "**/api/state**", {
      status: 503,
      body: { error: "Temporary test outage" },
    });

    await freezeBrowserDate(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Wayne Enterprises could not be opened" })).toBeVisible();
    await expect(page.getByText(/previous company remains safely hidden/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add client" })).toHaveCount(0);
    expect(stateFailure.attempts()).toBeGreaterThan(0);

    stateFailure.release();
    await page.getByRole("button", { name: "Retry" }).click();
    await waitForAppLanding(page, page.locator("#main"));
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);

    await expect(page.getByText("Bruce Wayne")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Wayne Enterprises could not be opened" })).toHaveCount(0);
  });
}

function registerFailedSaveStaysVisiblyUnsavedTest() {
  test("an uncertain typed save is not replayed and a deliberate retry persists exactly once", async ({
    page,
    request,
  }) => {
    await openApp(page, "Wayne Enterprises", "/clients");
    const clientFailure = await failRequestsUntilReleased(page, "**/api/accounts/*/clients", {
      status: 503,
      body: { error: "Temporary test outage" },
    });

    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Retry Recovery Co");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(clientFailure.attempts).toBe(1);
    await expect(page.getByRole("dialog", { name: "Add client" }).getByText("Temporary test outage")).toBeVisible();
    expect(
      requireStateRows(await serverState(request), "clients").filter(({ name }) => name === "Retry Recovery Co"),
    ).toHaveLength(0);

    clientFailure.release();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    expect(clientFailure.attempts()).toBe(1);
    expect(
      requireStateRows(await serverState(request), "clients").filter(({ name }) => name === "Retry Recovery Co"),
    ).toHaveLength(0);

    // An unknown commitment cannot be safely replayed. Reload authoritative state, then retry explicitly.
    await openApp(page, "Wayne Enterprises", "/clients");
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Retry Recovery Co");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(
        async () =>
          requireStateRows(await serverState(request), "clients").filter(({ name }) => name === "Retry Recovery Co")
            .length,
      )
      .toBe(1);
    expect(clientFailure.attempts()).toBe(1);

    await openApp(page, "Wayne Enterprises", "/clients");
    await expect(page.getByTestId("client-row").filter({ hasText: "Retry Recovery Co" })).toHaveCount(1);
  });
}

function registerStaleConcurrentEditRejectedExplainedTests() {
  test("a stale concurrent edit is rejected, explained, and replaced by server truth", async ({
    page,
    request,
    newObservedContext,
  }) => {
    await openApp(page, "Wayne Enterprises", "/clients");
    const secondContext = await newObservedContext({ baseURL: new URL(page.url()).origin });
    const secondSignIn = await secondContext.request.post(`${API}/api/auth/sign-in`, {
      data: { email: "admin@admin.admin", password: "auth-e2e-password-2026" },
    });
    expect(secondSignIn.status()).toBe(200);
    const secondPage = await secondContext.newPage();
    await openApp(secondPage, "Wayne Enterprises", "/clients");

    const firstRow = page.getByTestId("client-row").filter({ hasText: "Queen Consolidated" });
    const secondRow = secondPage.getByTestId("client-row").filter({ hasText: "Queen Consolidated" });
    await firstRow.getByRole("button", { name: /^Edit / }).click();
    await secondRow.getByRole("button", { name: /^Edit / }).click();

    await page.getByRole("dialog").getByRole("textbox", { name: "Name", exact: true }).fill("First Editor Co");
    await secondPage
      .getByRole("dialog")
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Stale Second Editor Co");

    await page.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(async () => requireStateRows(await serverState(request), "clients").find(({ id }) => id === "c-acme")?.name)
      .toBe("First Editor Co");

    const conflict = secondPage.waitForResponse((response) => {
      const path = new URL(response.url()).pathname;
      return response.request().method() === "PATCH" && /\/api\/accounts\/[^/]+\/clients\/c-acme$/.test(path);
    });
    await secondPage.getByRole("button", { name: "Save" }).click();
    expect((await conflict).status()).toBe(409);
    await expect(
      secondPage.getByRole("dialog", { name: "Edit client" }).getByText(/planning revision changed/i),
    ).toBeVisible();
    await secondPage.getByRole("dialog", { name: "Edit client" }).getByRole("button", { name: "Cancel" }).click();
    await expect(secondPage.getByTestId("client-row").filter({ hasText: "First Editor Co" })).toBeVisible();
    await expect(secondPage.getByTestId("client-row").filter({ hasText: "Stale Second Editor Co" })).toHaveCount(0);

    expect(requireStateRows(await serverState(request), "clients").find(({ id }) => id === "c-acme")?.name).toBe(
      "First Editor Co",
    );
    await secondContext.close();
  });
}

test.describe("database-backed resilience", () => {
  registerBeforeEachHooks();
  registerInitialStateFailurePreventsEditingTest();
  registerFailedSaveStaysVisiblyUnsavedTest();
  registerStaleConcurrentEditRejectedExplainedTests();
});
