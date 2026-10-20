import { test, expect } from "./fixtures";
import { resetServer, serverState, requireStateRows } from "./serverTestState";
import { failRequestsUntilReleased } from "./failRequestsUntilReleased";
import { waitForAppLanding, freezeBrowserDate, openApp } from "./browserTestSupport";

function registerBeforeEachHooks() {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request: request, withSeed: true });
  });
}

function registerInitialStateFailurePreventsEditingTest() {
  test("an initial planning read failure prevents editing and Retry recovers the real server data", async ({
    page,
  }) => {
    const stateFailure = await failRequestsUntilReleased(page, "**/api/accounts/*/planning", {
      status: 503,
      body: { error: "Temporary test outage" },
    });

    await freezeBrowserDate(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Can’t reach the server" })).toBeVisible();
    await expect(page.getByText(/nothing has been changed/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add client" })).toHaveCount(0);
    expect(stateFailure.attempts()).toBeGreaterThan(0);

    stateFailure.release();
    await page.getByRole("button", { name: "Try again" }).click();
    await waitForAppLanding(page, page.locator("#main"));
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);

    await expect(page.getByText("Bruce Wayne")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Can’t reach the server" })).toHaveCount(0);
  });
}

function registerFailedSaveStaysVisiblyUnsavedTest() {
  test("an uncertain typed create is checked by lookup and never resent", async ({ page, request }) => {
    await openApp(page, "Wayne Enterprises", "/clients");
    let createAttempts = 0;
    let mutationLookups = 0;
    await page.route("**/api/accounts/*/clients", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      createAttempts += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary test outage" }),
      });
    });
    page.on("request", (outgoing) => {
      if (outgoing.method() === "GET" && outgoing.url().includes("/planning/mutations/")) mutationLookups += 1;
    });

    await page.getByRole("button", { name: "Add client" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Uncertain Recovery Co");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("button", { name: "Check saved change" })).toBeVisible();
    await expect.poll(() => createAttempts).toBe(1);
    expect(
      requireStateRows(await serverState(request), "clients").filter(({ name }) => name === "Uncertain Recovery Co"),
    ).toHaveLength(0);

    await page.getByRole("button", { name: "Check saved change" }).click();
    await expect.poll(() => mutationLookups).toBe(1);
    await expect.poll(() => createAttempts).toBe(1);
    await expect(dialog).toBeVisible();
    expect(
      requireStateRows(await serverState(request), "clients").filter(({ name }) => name === "Uncertain Recovery Co"),
    ).toHaveLength(0);
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

    let staleSubmissions = 0;
    let staleStatus: number | undefined;
    let staleCode: string | undefined;
    await secondPage.route("**/api/accounts/*/clients/c-acme", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      staleSubmissions += 1;
      const response = await route.fetch();
      staleStatus = response.status();
      const body = await response.text();
      try {
        staleCode = (JSON.parse(body) as { code?: string }).code;
      } catch {
        staleCode = undefined;
      }
      await route.fulfill({ response, body });
    });

    const staleDialog = secondPage.getByRole("dialog");
    await staleDialog.getByRole("button", { name: "Save" }).click();
    const refusal = staleDialog.getByText(/changed while this draft was open|stale|conflict/i);
    await expect(refusal).toBeVisible();
    if (staleSubmissions === 0) {
      await expect(
        staleDialog.getByText(
          "This client changed while you were editing. Close and reopen the form, then re-apply your changes.",
        ),
      ).toBeVisible();
    } else {
      expect(staleSubmissions).toBe(1);
      expect(staleStatus).toBe(409);
      expect(staleCode).toBe("stale_revision");
    }
    await expect(staleDialog).toBeVisible();
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
