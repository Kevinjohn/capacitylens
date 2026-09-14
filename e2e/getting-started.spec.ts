import { test, expect } from "./fixtures";
import { openApp, openNewCompany, selectShadOption } from "./helpers";
import { TOUR_ANCHORS } from "../src/lib/tourAnchors";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// First-run "Getting started" checklist + "Show me around" tour (US-NAV-13). The card is
// state-driven: it shows only while the ACTIVE company lacks a useful first-use outcome, so the
// seeded companies (full data) never show it — these specs create a FRESH empty company (same
// picker flow as onboarding.spec.ts, via helpers.ts's `openNewCompany`) to see it. Dismissal is
// the device-global `capacitylens/gettingStartedDismissed` pref, mirroring the intro page's flag.

function registerSuiteScenario1() {
  test("a seeded (fully set up) company never shows the card", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expect(page.getByTestId("getting-started")).toHaveCount(0);
  });
}

function registerSuiteScenario2() {
  test("manual setup completes after a person, internal activity and allocation are connected", async ({ page }) => {
    await openNewCompany(page, "Fresh Co");
    const card = page.getByTestId("getting-started");
    await expect(card).toBeVisible();
    // The checklist floats over the grid; it must not consume a row in the schedule layout, push
    // the toolbar/grid down, or cover the right-hand toolbar actions on a first visit.
    await expect(card).toHaveCSS("position", "absolute");
    const toolbarBefore = await page.getByTestId("scheduler-toolbar").boundingBox();
    const gridBefore = await page.getByTestId("scheduler-grid").boundingBox();
    expect(toolbarBefore).not.toBeNull();
    expect(gridBefore).not.toBeNull();
    const toolbarAfter = await page.getByTestId("scheduler-toolbar").boundingBox();
    const gridAfter = await page.getByTestId("scheduler-grid").boundingBox();
    expect(toolbarAfter?.y).toBe(toolbarBefore?.y);
    expect(gridAfter?.y).toBe(gridBefore?.y);
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.y).toBeGreaterThanOrEqual(gridAfter!.y);
    await expect(card.getByRole("link", { name: "Import CapacityLens data" })).toBeVisible();
    await card.getByRole("button", { name: "Set up manually" }).click();
    await card.getByRole("link", { name: "Add someone to the schedule" }).click();
    await expect(page.getByRole("link", { name: "Getting started: 0 of 3 complete" })).toBeVisible();
    await page.getByRole("button", { name: "Add resource" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Bruce Wayne");
    await page.getByLabel("Role").fill("Designer");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("link", { name: "Getting started: 1 of 3 complete" })).toBeVisible();

    await page.getByRole("link", { name: "Activities" }).click();
    await page.getByRole("button", { name: "Add activity" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Studio planning");
    await page.getByRole("radio", { name: "Internal" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("link", { name: "Getting started: 2 of 3 complete" })).toBeVisible();

    await page.getByRole("link", { name: "Schedule" }).click();
    await page.getByRole("button", { name: "Add allocation for Bruce Wayne" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), {
      label: "Studio planning",
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(card).toHaveCount(0);
  });
}

function registerSuiteScenarioImportPath() {
  test("the import link opens Settings but does not count as completion", async ({ page }) => {
    await openNewCompany(page, "Queen Industries");
    const card = page.getByTestId("getting-started");
    await card.getByRole("link", { name: "Import CapacityLens data" }).click();
    await expect(page).toHaveURL(/\/settings#getting-started-import/);
    const importSection = page.locator("#getting-started-import");
    await expect(importSection).toBeFocused();
    await expect(importSection).toContainText("Import JSON");

    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByTestId("getting-started")).toBeVisible();
    await expect(page.getByTestId("getting-started").getByText("Add someone to the schedule")).toBeVisible();
    await expect(page.getByTestId("getting-started").getByText(/^Done:/)).toHaveCount(0);
  });
}

function registerSuiteScenario3() {
  test("the overflowing card scrolls with a pointer wheel at a short viewport", async ({ page }) => {
    // Keep the available panel height below the card's compact WebKit rendering too. At 320px
    // WebKit can fit the same content that overflows in Chromium, so that viewport did not
    // actually exercise the scrolling contract on every supported browser.
    await page.setViewportSize({ width: 1000, height: 240 });
    await openNewCompany(page, "Fresh Co");
    const card = page.getByTestId("getting-started");
    await expect(card).toBeVisible();
    await expect.poll(() => card.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.wheel(0, 300);

    await expect.poll(() => card.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });
}

function registerSuiteScenario4() {
  test('"Show me around" runs the loose orientation tour', async ({ page }) => {
    await openNewCompany(page, "Fresh Co");
    for (const selector of TOUR_ANCHORS) {
      await expect(page.locator(selector), `tour anchor ${selector}`).toHaveCount(1);
      await expect(page.locator(selector), `visible tour anchor ${selector}`).toBeVisible();
    }
    await page.getByTestId("getting-started-tour").click();

    // Stop 1: the schedule grid. The tour never navigates — URL stays on the schedule throughout.
    const popover = page.locator(".driver-popover");
    await expect(popover).toBeVisible();
    await expect(popover.getByText("The schedule")).toBeVisible();
    await expect(page.getByTestId("getting-started-tour")).toBeDisabled();

    await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.getByText("Search, filters and zoom")).toBeVisible();

    await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.getByText("People", { exact: true })).toBeVisible();

    await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.getByText("Clients & projects", { exact: true })).toBeVisible();

    await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.getByText("Settings", { exact: true })).toBeVisible();

    // Escape bails out of the tour without side effects; the checklist card is still there.
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(page.getByTestId("getting-started-tour")).toBeEnabled();
    await expect(page.getByTestId("getting-started")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
}

function registerSuiteScenario5() {
  test("Dismiss hides the card and persists the device-global flag", async ({ page }) => {
    await openNewCompany(page, "Fresh Co");
    await page.getByTestId("getting-started-dismiss").click();
    await expect(page.getByTestId("getting-started")).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem("capacitylens/gettingStartedDismissed"));
    expect(stored).toBe("on");
  });
}

test.describe("getting started checklist", () => {
  registerSuiteScenario1();
  registerSuiteScenario2();
  registerSuiteScenarioImportPath();
  registerSuiteScenario3();
  registerSuiteScenario4();
  registerSuiteScenario5();
});
