import { test, expect } from "./fixtures";
import { openApp, selectShadOption, showScheduleFilters } from "./helpers";

// Covers US-FIL-01..07. Seed has 6 allocations (one tentative: Bruce's Visual Design)
// and 5 resource rows across Design/Development/Copywriting.
test.describe("Filters", () => {
  test("searches resources by name and hides non-matching rows", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Clark Kent" })).toBeVisible();
    await page.getByLabel("Search people").fill("Bruce");
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" })).toBeVisible();
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Clark Kent" })).toHaveCount(0);
  });

  test("filters the schedule by discipline", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await selectShadOption(page.getByLabel("Filter by discipline"), {
      label: "Development",
    });
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Clark Kent" })).toBeVisible();
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" })).toHaveCount(0);
  });

  test("filters bars to a client", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await selectShadOption(page.getByLabel("Filter by client"), {
      label: "LexCorp",
    });
    // LexCorp only owns Metropolis Rebrand → the schedule collapses to just that work by default.
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Brand System" })).toBeVisible();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(1);
    // Opting into "Show unallocated" brings back the resources with no LexCorp work,
    // dimmed, so you can see who's free to staff.
    await page.getByLabel("Show unallocated").check();
    await expect(page.locator('[data-testid="scheduler-row"][data-dimmed]').first()).toBeVisible();
  });

  test("filters the schedule to a single project", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await selectShadOption(page.getByLabel("Filter by project"), "p-brand");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(1);
  });

  test("hides tentative bars while capacity still counts them", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const before = await page.getByTestId("allocation-bar").count();
    await page.getByLabel("Hide tentative").check();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1); // Bruce's tentative bar
    // Capacity is still truthful: Bruce's 3-4 June over-marker remains.
    await expect(page.getByTestId("over-marker").first()).toBeVisible();
  });

  test("clears all active filters with the Clear Filters button", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const all = await page.getByTestId("allocation-bar").count();
    const clear = page.getByRole("button", { name: "Clear Filters" });
    await expect(clear).toBeVisible();
    await expect(clear).toBeDisabled();
    await expect(clear).toHaveAttribute("data-variant", "outline");
    await selectShadOption(page.getByLabel("Filter by project"), "p-brand");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(1);
    await expect(clear).toBeEnabled();
    await expect(clear).toHaveAttribute("data-variant", "danger-soft");
    await expect(clear.locator(".lucide-trash-2")).toHaveAttribute("aria-hidden", "true");
    await clear.click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(all);
    await expect(clear).toBeDisabled();
  });

  test("shows the filtered empty state when nothing matches", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await page.getByLabel("Search people").fill("nobody-matches-this");
    await expect(page.getByTestId("scheduler-empty")).toBeVisible();
    await expect(page.getByTestId("scheduler-empty")).toContainText(/match the current filters/i);
    // The empty state offers an in-context "Clear filters" button (also the focusable element that
    // keeps the scrollable grid axe-clean): clicking it clears the search and the schedule returns.
    await page.getByTestId("scheduler-empty").getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("scheduler-empty")).toBeHidden();
    await expect(page.getByTestId("allocation-bar").first()).toBeVisible();
  });

  test("filters the schedule to a cross-project activity (the activity lens)", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    // Seed books "Design" (a cross-project activity) for Barry across 8-10 June.
    await selectShadOption(page.getByLabel("Filter by activity"), "kind:repeatable");
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Design" })).toBeVisible();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(1);
  });

  test("the activity lens is mutually exclusive with the client / project lens", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    // Activate a project lens, then switch to the activity lens — the project dropdown resets.
    await selectShadOption(page.getByLabel("Filter by project"), "p-brand");
    await expect(page.getByLabel("Filter by project")).toHaveText("LexCorp / Metropolis Rebrand");
    await selectShadOption(page.getByLabel("Filter by activity"), "kind:repeatable");
    await expect(page.getByLabel("Filter by project")).toHaveText("All projects");

    // And back the other way: choosing a project clears the activity lens.
    await selectShadOption(page.getByLabel("Filter by project"), "p-brand");
    await expect(page.getByLabel("Filter by activity")).toHaveText("All activities");
  });
});
