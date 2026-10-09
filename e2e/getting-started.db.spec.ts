import { test, expect } from "./fixtures";
import { waitForAppLanding } from "./browserTestSupport";
import { API, resetServer } from "./serverTestState";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("server-backed role tour", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request, withSeed: false });
  });

  test("returns from Settings to Schedule and shows all eight Owner stops", async ({ page, request }) => {
    const created = await request.post(`${API}/api/orgs`, { data: { name: "Wayne Enterprises" } });
    expect(created.status()).toBe(201);
    const company = (await created.json()) as { id: string; name: string };

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();
    await page.getByRole("button", { name: company.name, exact: true }).click();
    await waitForAppLanding(page, page.locator("#main"));
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("button", { name: "Show checklist" }).click();
    await page.getByTestId("getting-started-tour").click();

    const popover = page.locator(".driver-popover");
    await expect(popover).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(popover.getByText("Owner: Import and restore schedules")).toBeVisible();
    await expect(popover.getByText("1 of 8")).toBeVisible();
    await expect(page.locator('[data-nav="/team"]')).toBeVisible();

    for (let stop = 1; stop < 8; stop += 1) await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.getByText("8 of 8")).toBeVisible();
    await expect(popover.getByText("Viewer: Search, filters and weeks")).toBeVisible();
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expect(page.getByTestId("scheduler-toolbar")).toBeVisible();
    await popover.getByRole("button", { name: "Done" }).click();
    await expect(popover).toHaveCount(0);
  });
});
