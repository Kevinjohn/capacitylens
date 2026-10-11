import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { disableCssMotion, openApp, showScheduleFilters } from "./browserTestSupport";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.use({ contextOptions: { reducedMotion: "reduce" } });

function registerOpensControlShowsActionsPagesTest() {
  test("opens with Control+K, shows Actions and Pages, closes with Escape", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await expect(page.getByTestId("command-palette-input")).toBeFocused();

    await expect(page.getByTestId("command-palette").getByText("Go to today")).toBeVisible();

    // Shows Pages section with every first-class route (scoped to the palette to avoid strict-mode
    // violations from other elements with the same text on the page below).
    const palette = page.getByTestId("command-palette");
    for (const label of [
      "Overview",
      "Schedule",
      "Resources",
      "Team & access",
      "Disciplines",
      "Clients",
      "Projects",
      "Activities",
      "Time off",
      "Settings",
      "Account",
    ]) {
      await expect(palette.getByText(label, { exact: true }).last()).toBeVisible();
    }

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).not.toBeVisible();
  });
}

function registerToggleSecondControlClosesOpenTest() {
  test("toggle: second Control+K closes an open palette", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).not.toBeVisible();
  });
}

function registerOpensInputFieldCtrlFiresTest() {
  test("opens from an input field (Ctrl+K fires even while typing)", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    const searchInput = page.getByPlaceholder("Search people…");
    await searchInput.click();
    await searchInput.type("ty");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
  });
}

function registerFuzzyFindsSeededResourceJumpsTest() {
  test("fuzzy-finds a seeded resource and jumps to their lane", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await page.getByTestId("command-palette-input").fill("Bruce");

    await expect(page.getByText("People")).toBeVisible();
    const bruceOption = page.getByTestId("command-palette-option").filter({ hasText: "Bruce Wayne" });
    await expect(bruceOption).toBeVisible();

    await bruceOption.click();

    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    await expect(page.locator('[data-resource-id="r-tyler"]')).toBeVisible();
  });
}

function registerKeyboardTypeArrowDownEnterTest() {
  test("keyboard: type + arrow down + Enter selects and closes", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");

    await page.getByTestId("command-palette-input").fill("Clark");

    await page.keyboard.press("ArrowDown");
    const options = page.getByTestId("command-palette-option");
    await expect(options.filter({ hasText: "Clark Kent" })).toBeVisible();
    const activeId = await page.getByTestId("command-palette-input").getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Enter");

    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expect(page.locator('[data-resource-id="r-nike"]')).toBeVisible();
  });
}

function registerNavigatesPagePaletteTest() {
  test("navigates to a page via the palette", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");

    await page.getByTestId("command-palette-input").fill("res");

    const resourcesOption = page.getByTestId("command-palette-option").filter({ hasText: "Resources" });
    await expect(resourcesOption).toBeVisible();
    await resourcesOption.click();

    await expect(page.getByRole("button", { name: "Add resource" })).toBeVisible();
  });
}

function registerGoTodayActionNavigatesScheduleTest() {
  test("Go to today action navigates to schedule and recenters", async ({ page }) => {
    await openApp(page);
    const grid = page.getByTestId("scheduler-grid");
    await grid.evaluate((el) => {
      (el as HTMLElement).scrollLeft = 5000;
    });
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeGreaterThan(4000);
    await page.getByRole("link", { name: "Resources" }).click();

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByText("Go to today").click();

    await expect(grid).toBeVisible();
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeLessThan(4000);
  });
}

function registerClientActivityResultsApplyDocumentedTest() {
  test("client and activity results apply their documented destinations", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-palette-input").fill("Queen Consolidated");
    await page.getByTestId("command-palette-option").filter({ hasText: "Queen Consolidated" }).click();
    await showScheduleFilters(page);
    await expect(page.getByRole("combobox", { name: "Filter by client" })).toHaveText("Queen Consolidated");

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-palette-input").fill("Brand System");
    await page.getByTestId("command-palette-option").filter({ hasText: "Brand System" }).click();
    await expect(page).toHaveURL(/\/activities#activity=t-brand$/);
    await expect(page.getByText("Brand System", { exact: true })).toBeVisible();
  });
}

function registerGoDateActionAppearsValidTest() {
  test("Go to date action appears for valid ISO date query", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");

    await page.getByTestId("command-palette-input").fill("2026-06-03");

    await expect(page.getByText("Go to date 2026-06-03")).toBeVisible();

    await page.getByText("Go to date 2026-06-03").click();
    await expect(page.getByTestId("command-palette")).not.toBeVisible();
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
  });
}

function registerBackdropClickClosesPaletteTest() {
  test("backdrop click closes the palette", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await page.mouse.click(10, 10);

    await expect(page.getByTestId("command-palette")).not.toBeVisible();
  });
}

function registerDirtyFormGuardCtrlWhileTest() {
  test("dirty-form guard: Ctrl+K while a modal is dirty does not open the palette", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();

    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Dirty Client");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();

    await expect(page.getByText("You have unsaved changes — use Cancel or Save to close this dialog.")).toBeVisible();
  });
}

function registerImpossibleDate20260231Test() {
  test("impossible date 2026-02-31 does not show a Go to date option", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await page.getByTestId("command-palette-input").fill("2026-02-31");

    await expect(page.getByTestId("command-palette").getByText(/Go to date 2026-02-31/)).not.toBeVisible();
  });
}

function registerPaletteProjectSelectionReplacesStaleTest() {
  test("palette project selection replaces stale schedule filters", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    const searchInput = page.getByPlaceholder("Search people…");
    await searchInput.fill("zzz-nobody-matches-zzz");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await page.getByTestId("command-palette-input").fill("Watchtower");

    const projectOption = page.getByTestId("command-palette-option").filter({ hasText: "Project Watchtower" });
    await expect(projectOption).toBeVisible();
    await projectOption.click();

    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expect(page.getByTestId("scheduler-empty")).not.toBeVisible();

    await expect(page.getByRole("combobox", { name: "Filter by project" })).toHaveText(
      "Queen Consolidated / Project Watchtower",
    );
    await expect(page.getByPlaceholder("Search people…")).toHaveValue("");
  });
}

function registerPaletteHasSeriousCriticalAccessibilityTests() {
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
}

test.describe("Command palette", () => {
  registerOpensControlShowsActionsPagesTest();
  registerToggleSecondControlClosesOpenTest();
  registerOpensInputFieldCtrlFiresTest();
  registerFuzzyFindsSeededResourceJumpsTest();
  registerKeyboardTypeArrowDownEnterTest();
  registerNavigatesPagePaletteTest();
  registerGoTodayActionNavigatesScheduleTest();
  registerClientActivityResultsApplyDocumentedTest();
  registerGoDateActionAppearsValidTest();
  registerBackdropClickClosesPaletteTest();
  registerDirtyFormGuardCtrlWhileTest();
  registerImpossibleDate20260231Test();
  registerPaletteProjectSelectionReplacesStaleTest();
  registerPaletteHasSeriousCriticalAccessibilityTests();
});
