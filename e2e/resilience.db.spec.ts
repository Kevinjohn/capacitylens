import { test, expect } from "./fixtures";
import { resetServer, serverState } from "./db-helpers";
import { failRequestsUntilReleased } from "./fault-helpers";
import { dismissIntroIfPresent, freezeBrowserDate, openApp } from "./helpers";

const PERSISTENCE_WARNING = "Changes aren’t being saved right now — we’ll keep retrying.";

test.describe("database-backed resilience", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer(request, true);
  });

  test("an initial state failure prevents editing and Retry recovers the real server data", async ({ page }) => {
    const stateFailure = await failRequestsUntilReleased(page, "**/api/state", {
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
    await page.getByRole("button", { name: "Wayne Enterprises", exact: true }).click();
    await dismissIntroIfPresent(page, page.locator("#main"));

    await expect(page.getByText("Bruce Wayne")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Can’t reach the server" })).toHaveCount(0);
  });

  test("a failed save stays visibly unsaved, retries, and persists exactly once", async ({ page, request }) => {
    await openApp(page, "Wayne Enterprises", "/clients");
    const batchFailure = await failRequestsUntilReleased(page, "**/api/batch", {
      status: 503,
      body: { error: "Temporary test outage" },
    });

    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Retry Recovery Co");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(batchFailure.attempts).toBeGreaterThan(0);
    await expect(page.getByRole("alert").filter({ hasText: PERSISTENCE_WARNING })).toBeVisible();
    expect((await serverState(request)).clients.filter(({ name }) => name === "Retry Recovery Co")).toHaveLength(0);

    batchFailure.release();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect
      .poll(async () => (await serverState(request)).clients.filter(({ name }) => name === "Retry Recovery Co").length)
      .toBe(1);
    await expect(page.getByRole("alert").filter({ hasText: PERSISTENCE_WARNING })).toHaveCount(0);

    await openApp(page, "Wayne Enterprises", "/clients");
    await expect(page.getByTestId("client-row").filter({ hasText: "Retry Recovery Co" })).toHaveCount(1);
  });

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
      .poll(async () => (await serverState(request)).clients.find(({ id }) => id === "c-acme")?.name)
      .toBe("First Editor Co");

    await secondPage.getByRole("button", { name: "Save" }).click();
    await expect(secondPage.getByText(/your last edit conflicted and was not saved/i)).toBeVisible();
    await expect(secondPage.getByTestId("client-row").filter({ hasText: "First Editor Co" })).toBeVisible();
    await expect(secondPage.getByTestId("client-row").filter({ hasText: "Stale Second Editor Co" })).toHaveCount(0);
    await expect(secondPage.getByRole("alert").filter({ hasText: PERSISTENCE_WARNING })).toHaveCount(0);

    expect((await serverState(request)).clients.find(({ id }) => id === "c-acme")?.name).toBe("First Editor Co");
    await secondContext.close();
  });
});
