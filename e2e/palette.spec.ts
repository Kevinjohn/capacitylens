import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { disableCssMotion, openApp } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("Command palette", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("opens with Control+K, shows Actions and Pages, closes with Escape", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    // Palette is not visible initially
    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    // Open with Ctrl+K (or Cmd+K — Playwright maps ControlOrMeta)
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    // Input is focused
    await expect(page.getByTestId("command-palette-input")).toBeFocused();

    // Shows Actions section
    await expect(page.getByTestId("command-palette").getByText("Go to today")).toBeVisible();

    // Shows Pages section with every first-class route (scoped to the palette to avoid strict-mode
    // violations from other elements with the same text on the page below).
    const palette = page.getByTestId("command-palette");
    for (const label of [
      "Schedule",
      "Resources",
      "Team & access",
      "Disciplines",
      "Clients",
      "Projects",
      "Activities",
      "Time off",
      "Settings",
    ]) {
      await expect(palette.getByText(label, { exact: true }).last()).toBeVisible();
    }

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).not.toBeVisible();
  });

  test("toggle: second Control+K closes an open palette", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    // Second press closes it
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).not.toBeVisible();
  });

  test("opens from an input field (Ctrl+K fires even while typing)", async ({ page }) => {
    await openApp(page);
    // Focus the "Search people…" input on the scheduler
    const searchInput = page.getByPlaceholder("Search people…");
    await searchInput.click();
    await searchInput.type("ty");

    // Ctrl+K should open palette even while typing in the search field
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
  });

  test("fuzzy-finds a seeded resource and jumps to their lane", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    // Open palette
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    // Type the resource name (seeded: "Bruce Wayne")
    await page.getByTestId("command-palette-input").fill("Bruce");

    // Wait for People section with Bruce Wayne option
    await expect(page.getByText("People")).toBeVisible();
    const bruceOption = page.getByTestId("command-palette-option").filter({ hasText: "Bruce Wayne" });
    await expect(bruceOption).toBeVisible();

    // Navigate to Bruce with ArrowDown and Enter (or just click)
    await bruceOption.click();

    // Palette should be closed
    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    // Schedule should still be visible (we navigated to '/' and jumped to Bruce)
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    // Bruce Wayne's lane should be visible (scrolled into view)
    await expect(page.locator('[data-resource-id="r-tyler"]')).toBeVisible();
  });

  test("keyboard: type + arrow down + Enter selects and closes", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");

    // Type to filter resources
    await page.getByTestId("command-palette-input").fill("Clark");

    // ArrowDown to first result (Clark Kent should appear)
    await page.keyboard.press("ArrowDown");
    // The active option should advance
    const options = page.getByTestId("command-palette-option");
    // Find the Clark Kent option
    await expect(options.filter({ hasText: "Clark Kent" })).toBeVisible();
    const activeId = await page.getByTestId("command-palette-input").getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");

    // Press Enter
    await page.keyboard.press("Enter");

    // Palette closes
    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    // Clark Kent's lane should be on the schedule
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expect(page.locator('[data-resource-id="r-nike"]')).toBeVisible();
  });

  test("navigates to a page via the palette", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");

    // Type "res" to find Resources page
    await page.getByTestId("command-palette-input").fill("res");

    // Click the Resources page option
    const resourcesOption = page.getByTestId("command-palette-option").filter({ hasText: "Resources" });
    await expect(resourcesOption).toBeVisible();
    await resourcesOption.click();

    // Should navigate to /resources
    await expect(page.getByRole("button", { name: "Add resource" })).toBeVisible();
  });

  test("Go to today action navigates to schedule and recenters", async ({ page }) => {
    await openApp(page);
    const grid = page.getByTestId("scheduler-grid");
    await grid.evaluate((el) => {
      (el as HTMLElement).scrollLeft = 5000;
    });
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeGreaterThan(4000);
    await page.getByRole("link", { name: "Resources" }).click();

    // Open palette and click "Go to today"
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByText("Go to today").click();

    // It returns to the schedule and applies the recenter action, rather than merely navigating.
    await expect(grid).toBeVisible();
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeLessThan(4000);
  });

  test("client and activity results apply their documented destinations", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-palette-input").fill("Queen Consolidated");
    await page.getByTestId("command-palette-option").filter({ hasText: "Queen Consolidated" }).click();
    await expect(page.getByRole("combobox", { name: "Filter by client" })).toHaveText("Queen Consolidated");

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-palette-input").fill("Brand System");
    await page.getByTestId("command-palette-option").filter({ hasText: "Brand System" }).click();
    await expect(page).toHaveURL(/\/activities#activity=t-brand$/);
    await expect(page.getByText("Brand System", { exact: true })).toBeVisible();
  });

  test("Go to date action appears for valid ISO date query", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");

    await page.getByTestId("command-palette-input").fill("2026-06-03");

    await expect(page.getByText("Go to date 2026-06-03")).toBeVisible();

    await page.getByText("Go to date 2026-06-03").click();
    await expect(page.getByTestId("command-palette")).not.toBeVisible();
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
  });

  test("backdrop click closes the palette", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    // Click on the backdrop (the outer fixed overlay area, outside the panel)
    // Use a coordinate that is on the backdrop but outside the panel (bottom-left corner area)
    await page.mouse.click(10, 10);

    await expect(page.getByTestId("command-palette")).not.toBeVisible();
  });

  test("dirty-form guard: Ctrl+K while a modal is dirty does not open the palette", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    // Open the Add client form (a real modal) to get a dirty form
    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();

    // Make the form dirty by typing in the Name field
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Dirty Client");

    // Now press ControlOrMeta+K — the palette must NOT appear
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    // The modal (form) must still be visible
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();

    // The unsaved-changes notice must appear
    await expect(page.getByText("You have unsaved changes — use Cancel or Save to close this dialog.")).toBeVisible();
  });

  test("impossible date 2026-02-31 does not show a Go to date option", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await page.getByTestId("command-palette-input").fill("2026-02-31");

    // No "Go to date 2026-02-31" option should appear
    await expect(page.getByTestId("command-palette").getByText(/Go to date 2026-02-31/)).not.toBeVisible();
  });

  test("palette project selection replaces stale schedule filters", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    // Pre-set a stale search filter that would leave the schedule empty
    const searchInput = page.getByPlaceholder("Search people…");
    await searchInput.fill("zzz-nobody-matches-zzz");

    // Open palette and select a seeded project (Project Watchtower)
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await page.getByTestId("command-palette-input").fill("Watchtower");

    const projectOption = page.getByTestId("command-palette-option").filter({ hasText: "Project Watchtower" });
    await expect(projectOption).toBeVisible();
    await projectOption.click();

    // Palette closed
    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    // Scheduler must be visible (not the empty-state)
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expect(page.getByTestId("scheduler-empty")).not.toBeVisible();

    // The project filter must show Project Watchtower and the stale search text must be gone.
    await expect(page.getByRole("combobox", { name: "Filter by project" })).toHaveText(
      "Queen Consolidated / Project Watchtower",
    );
    await expect(page.getByPlaceholder("Search people…")).toHaveValue("");
  });

  test("palette has no serious or critical accessibility violations (light mode)", async ({ page }) => {
    await openApp(page);
    await disableCssMotion(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      blocking,
      JSON.stringify(
        blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })),
        null,
        2,
      ),
    ).toEqual([]);
  });
});
