import { test, expect } from "./fixtures";
import { boundingBoxOrThrow as box, setZoom, showPlaceholders } from "./browserTestSupport";
import { openApp } from "./appEntrySupport";
import { resetSchedulerScroll, waitForWeekSnap } from "./schedulerGeometrySupport";

// Covers US-SET-06. Placeholders are a per-account view pref (`placeholdersEnabled` on the active
// Account, absent = false), default off, hidden everywhere out of the box, but their data is
// untouched and returns when the switch goes on. The seed has one placeholder (r-ph-designer,
// role "Senior Designer", bound to Project Watchtower) so the toggle is demonstrable.
function registerDrawingPlaceholderLocksModalBoundTests() {
  test("drawing on a placeholder locks the modal to its bound project", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await showPlaceholders(page);
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    await waitForWeekSnap(page);

    const lane = page.locator('[data-resource-id="r-ph-designer"]');
    const b = await box(lane);
    const y = b.y + b.height / 2;
    // Start on an empty working day inside the reset window instead of the lane origin, which sits
    // underneath the sticky resource column.
    const monday = await box(page.getByTestId("scheduler-day-tier").locator('[data-date="2026-05-11"]'));
    const timeline = await box(page.getByTestId("scheduler-resource-header"));
    const grid = await box(page.getByTestId("scheduler-grid"));
    const x0 = monday.x + monday.width / 2;
    const x1 = x0 + monday.width;
    expect(x0).toBeGreaterThan(timeline.x + timeline.width);
    expect(x1).toBeLessThan(grid.x + grid.width);
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x1, y, { steps: 6 });
    await page.mouse.up();

    await expect(page.getByRole("dialog", { name: "New allocation" })).toBeVisible();
    const project = page.getByLabel("Project", { exact: true });
    // "Locked" = the bound project is preselected and the choices are restricted to it
    // (+ the general option), but the select stays enabled so the placeholder can still
    // take general activities. A non-bound project ("Metropolis Rebrand") is not offered.
    await expect(project).toHaveText(/Project Watchtower/);
    await expect(project).toBeEnabled();
    await project.click();
    await expect(page.getByRole("option", { name: /Metropolis Rebrand/ })).toHaveCount(0);
  });
}

test.describe("Placeholders (per-account pref, default off)", () => {
  test("hidden by default: the seeded placeholder is absent from the schedule and Resources list", async ({ page }) => {
    await openApp(page);
    await expect(page.locator('[data-resource-id="r-ph-designer"]')).toHaveCount(0);
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Placeholder" })).toHaveCount(0);

    await page.getByRole("link", { name: "Resources" }).click();
    await expect(page.getByRole("heading", { name: "Placeholders" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add placeholder" })).toHaveCount(0);
  });

  test('turning it on in Settings reveals the placeholder with a "?" avatar and "Placeholder" name', async ({
    page,
  }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    const toggle = page.getByRole("switch", { name: "Show placeholders" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await page.getByRole("link", { name: "Resources" }).click();
    await expect(page.getByRole("heading", { name: "Placeholders" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add placeholder" })).toBeVisible();
    const phRow = page.getByTestId("resource-row").filter({ hasText: "Senior Designer" });
    await expect(phRow.getByText("Placeholder", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add placeholder" }).click();
    await expect(page.getByRole("group", { name: "Working days" })).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();

    // Schedule now shows the placeholder lane. The name + "?" avatar live in the row header (the
    // left sticky column), a sibling of the [data-resource-id] gridcell, so scope to the whole
    // scheduler-row that contains this placeholder's lane, then assert the header content.
    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.locator('[data-resource-id="r-ph-designer"]')).toBeVisible();
    const phScheduleRow = page
      .getByTestId("scheduler-row")
      .filter({ has: page.locator('[data-resource-id="r-ph-designer"]') });
    const header = phScheduleRow.getByRole("rowheader");
    await expect(header.getByText("Placeholder", { exact: true })).toBeVisible();
    await expect(header.getByText("?", { exact: true })).toBeVisible();
  });

  test("the choice survives navigation in the current demo session", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("switch", { name: "Show placeholders" }).click();
    await page.getByRole("link", { name: "Schedule" }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Show placeholders" })).toHaveAttribute("aria-checked", "true");
  });
  registerDrawingPlaceholderLocksModalBoundTests();
});
