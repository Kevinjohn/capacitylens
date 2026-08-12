import { test, expect } from "./fixtures";
import { openApp, selectShadOption, showScheduleFilters } from "./helpers";

// The account-level "Use disciplines" toggle (Settings → Disciplines). Off should hide
// discipline surfaces and use engagement fallback bands on the schedule; on restores disciplines.
test.describe("Disciplines optional (account-level)", () => {
  test("turning disciplines off hides every surface; turning it back on restores them", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");

    // Give the fallback a real Supplementary member before disabling disciplines so both engagement
    // bands are exercised in the browser, not just inferred from model tests.
    await page
      .getByTestId("resource-row")
      .filter({ hasText: "Diana Prince" })
      .getByRole("button", { name: "Edit Diana Prince" })
      .click();
    await selectShadOption(page.getByLabel("Engagement"), { label: "Supplementary" });
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("link", { name: "Settings" }).click();

    // Enable External (default off) so its final band is present; it's an independent account pref.
    await page.getByRole("switch", { name: "Show external resources" }).click();

    // On by default for the seed: the nav link is present and the switch reads on.
    await expect(page.getByRole("link", { name: "Disciplines" })).toBeVisible();
    const useDisciplines = page.getByRole("switch", { name: "Use disciplines" });
    await expect(useDisciplines).toHaveAttribute("aria-checked", "true");

    // Turn it off.
    await useDisciplines.click();
    await expect(useDisciplines).toHaveAttribute("aria-checked", "false");

    // Sidebar nav link is gone.
    await expect(page.getByRole("link", { name: "Disciplines" })).toHaveCount(0);

    // …and the collapsed icon mode drops it too: 8 destinations, no Disciplines.
    // (External is no longer a standalone nav link — it lives inside Resources.)
    await page.getByRole("button", { name: "Collapse menu" }).click();
    await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-state", "collapsed");
    await expect(page.getByRole("navigation").getByRole("link")).toHaveCount(8);
    await expect(page.getByRole("link", { name: "Disciplines" })).toHaveCount(0);
    await page.getByTestId("app-sidebar").getByRole("button", { name: "Expand menu" }).click();

    // Schedule falls back to Studio then Supplementary bands and hides the discipline filter.
    await page.getByRole("link", { name: "Schedule" }).click();
    await showScheduleFilters(page);
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" })).toBeVisible();
    const studio = page.getByTestId("discipline-group").filter({ hasText: "Studio" });
    const supplementary = page.getByTestId("discipline-group").filter({ hasText: "Supplementary" });
    await expect(studio).toBeVisible();
    await expect(supplementary).toBeVisible();
    await expect(studio).toContainText(/avg utilisation/);
    await expect(supplementary).toContainText(/avg utilisation/);

    // Synthetic bands retain the normal collapse interaction and row summaries.
    const studioToggle = studio.getByRole("button");
    await studioToggle.click();
    await expect(studioToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" })).toHaveCount(0);
    await studioToggle.click();
    await expect(studioToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" })).toContainText(/utilisation/i);

    // The External band is the LAST item; scroll to the bottom so it's inside the virtualised
    // window before asserting (the grid drops off-screen rows from the DOM).
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
    });
    // External remains the final headed band (the seeded Kord Industries makes it present here).
    await expect(page.getByTestId("discipline-group").filter({ hasText: "External / 3rd party" })).toBeVisible();
    await expect(page.getByLabel("Filter by discipline")).toHaveCount(0);

    // The command palette no longer offers the Disciplines page.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(page.getByTestId("command-palette-option").filter({ hasText: "Disciplines" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The resource form drops the Discipline field.
    await page.getByRole("link", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Add resource" }).click();
    await expect(page.getByLabel("Discipline")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();

    // The off state guards /disciplines for this demo session. Navigate without reloading: the
    // public demo is intentionally in-memory, so a fresh document would reset the seed instead of
    // proving the route guard against the state changed above.
    await page.evaluate(() => {
      window.history.pushState({}, "", "/disciplines");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    // Turn it back on — the nav link returns and the schedule regroups into discipline bands.
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("switch", { name: "Use disciplines" }).click();
    await expect(page.getByRole("link", { name: "Disciplines" })).toBeVisible();
    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByTestId("discipline-group").first()).toBeVisible();
  });
});
