import { test, expect } from "./dbFixtures";
import { waitForAppLanding } from "./browserTestSupport";
import { resetServer } from "./serverTestState";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("server-backed role tour", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request, withSeed: true });
  });

  test("returns from Settings to Schedule and shows all eight Owner stops", async ({ page }) => {
    await page.goto("/settings");
    await waitForAppLanding(page, page.locator("#main"));
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Switch company/i })).toHaveCount(0);
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
