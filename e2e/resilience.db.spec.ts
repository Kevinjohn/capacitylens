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
  test("an initial planning read failure prevents a write until reload recovers the real server data", async ({
    page,
    request,
  }) => {
    const stateFailure = await failRequestsUntilReleased(page, "**/api/accounts/*/planning", {
      status: 503,
      body: { error: "Temporary test outage" },
    });

    await freezeBrowserDate(page);
    await page.goto("/");

    await expect(page.getByRole("alert")).toContainText("The schedule couldn’t be loaded from the server");
    expect(stateFailure.attempts()).toBeGreaterThan(0);
    await expect(page.getByText("Bruce Wayne")).toHaveCount(0);

    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Outage Client");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add client" }).getByText("No active company is selected."),
    ).toBeVisible();
    expect(requireStateRows(await serverState(request), "clients").some(({ name }) => name === "Outage Client")).toBe(
      false,
    );

    stateFailure.release();
    await page.goto("/");
    await waitForAppLanding(page, page.locator("#main"));
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

function registerFailedSaveStaysVisiblyUnsavedTest() {
  test("an uncertain typed save is not replayed and a deliberate retry persists exactly once", async ({
    page,
    request,
  }) => {
    await openApp(page, "Wayne Enterprises", "/clients");
    const clientPosts: string[] = [];
    page.on("request", (browserRequest) => {
      const path = new URL(browserRequest.url()).pathname;
      if (browserRequest.method() === "POST" && /\/api\/accounts\/[^/]+\/clients$/.test(path)) clientPosts.push(path);
    });
    const clientFailure = await failRequestsUntilReleased(page, "**/api/accounts/*/clients", {
      status: 503,
      body: { error: "Temporary test outage" },
    });

    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Retry Recovery Co");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(clientFailure.attempts).toBe(1);
    expect(clientPosts).toHaveLength(1);
    await expect(page.getByRole("dialog", { name: "Add client" }).getByText("Temporary test outage")).toBeVisible();
    expect(
      requireStateRows(await serverState(request), "clients").filter(({ name }) => name === "Retry Recovery Co"),
    ).toHaveLength(0);

    clientFailure.release();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByRole("dialog", { name: "Add client" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog", { name: "Add client" }).getByText(/planning is not ready/i)).toBeVisible();
    expect(clientPosts).toHaveLength(1);
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
    expect(clientPosts).toHaveLength(2);

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
