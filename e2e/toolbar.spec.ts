import { test, expect } from "./fixtures";
import { boundingBoxOrThrow as box, setZoom, showScheduleFilters } from "./browserTestSupport";
import { openApp } from "./appEntrySupport";
import { resetSchedulerScroll } from "./schedulerGeometrySupport";

// Covers US-TBR-01..07 and the toolbar-owned week-snap cases from US-TBR-08; scheduler.spec.ts
// covers the remaining US-TBR-08 navigation paths.
function registerZoomsTimelineTracksActiveLevelTest() {
  test("zooms the timeline and tracks the active level", async ({ page }) => {
    await openApp(page);
    const weeks = page.getByRole("combobox", { name: "Weeks visible" });
    await setZoom(page, 6);
    await expect(weeks).toHaveText("6 weeks");
    await expect(page.getByText("Utilisation · 6w")).toBeVisible();

    await setZoom(page, 8);
    await expect(weeks).toHaveText("8 weeks");

    await setZoom(page, 1);
    await expect(weeks).toHaveText("1 week");
  });
}

function registerShowsZoomLevelDropdownOpensTest() {
  test("shows every zoom level when the dropdown opens", async ({ page }) => {
    await openApp(page);
    const weeks = page.getByRole("combobox", { name: "Weeks visible" });
    await weeks.click();

    const popup = page.locator('[data-slot="select-content"][data-state="open"]');
    const popupBox = await box(popup);
    const firstOptionBox = await box(popup.getByRole("option", { name: "1 week" }));
    const lastOptionBox = await box(popup.getByRole("option", { name: "8 weeks" }));

    expect(firstOptionBox.y).toBeGreaterThanOrEqual(popupBox.y);
    expect(lastOptionBox.y + lastOptionBox.height).toBeLessThanOrEqual(popupBox.y + popupBox.height);
  });
}

function registerPansWindowWeekPrevNextTest() {
  test("pans the window a week with Prev and Next", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Brand System" });
    const b0 = await box(bar);

    await page.getByRole("button", { name: "Next" }).click();
    const b1 = await box(bar);
    expect(b1.x).toBeLessThan(b0.x);

    await page.getByRole("button", { name: "Prev" }).click();
    const b2 = await box(bar);
    expect(b2.x).toBeGreaterThan(b1.x);
  });
}

function registerReCentresTodayScrollingAwayTest() {
  test("re-centres on Today after scrolling away", async ({ page }) => {
    await openApp(page);
    const grid = page.getByTestId("scheduler-grid");
    await grid.evaluate((el) => {
      (el as HTMLElement).scrollLeft = 5000;
    });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeLessThan(4000);
  });
}

// The toolbar has no jump-to-date picker in this layout.
// Its coverage lives at the two levels that still exercise it: the component
// (src/components/scheduler/JumpToDateInput.test.tsx) and the week-start snap it triggers
// (goToDate in src/store/useStore.test.ts). This test asserts only that it is gone from the bar.
function registerDoesExposeJumpDatePickerTest() {
  test("does not expose the jump-to-date picker", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-toolbar")).toBeVisible();
    await expect(page.getByLabel("Jump to date")).toHaveCount(0);
  });
}

function registerShowsResponsiveFilterRowSearchTest() {
  test("shows a responsive filter row with search left and the remaining controls grouped right", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openApp(page);
    const show = page.getByRole("button", { name: "Show filters" });
    const actions = page.getByTestId("scheduler-toolbar-actions");
    const redo = page.getByTestId("redo-button");

    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(show.locator("svg")).toHaveCount(1);
    await expect(actions.locator('[data-slot="separator"]')).toHaveCount(2);
    const [redoBox, showBox] = await Promise.all([redo.boundingBox(), show.boundingBox()]);
    expect(redoBox).not.toBeNull();
    expect(showBox).not.toBeNull();
    expect(showBox!.x).toBeGreaterThan(redoBox!.x);
    await expect(page.getByLabel("Search people")).toHaveCount(0);
    await show.click();

    const hide = page.getByRole("button", { name: "Hide filters" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    const filterbar = page.locator("#scheduler-filters");
    const search = page.getByLabel("Search people");
    const controls = page.getByTestId("scheduler-filter-controls");
    const clear = page.getByRole("button", { name: "Clear Filters" });
    await expect(search).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Draw mode" })).toBeVisible();
    await search.fill("Clark");
    await expect(clear).toBeEnabled();

    const [filterbarBox, searchBox, controlsBox, clearBox] = await Promise.all([
      box(filterbar),
      box(search),
      box(controls),
      box(clear),
    ]);
    expect(searchBox.x).toBeLessThanOrEqual(filterbarBox.x + 17);
    expect(controlsBox.x).toBeGreaterThan(searchBox.x + searchBox.width);
    expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(controlsBox.x + controlsBox.width + 1);
    expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(filterbarBox.x + filterbarBox.width);

    await page.setViewportSize({ width: 800, height: 900 });
    await expect
      .poll(() => filterbar.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(0);
    const narrowLayout = await filterbar.evaluate((element) => ({
      controlsBottom: element.children[1]?.getBoundingClientRect().bottom,
      filterbarBottom: element.getBoundingClientRect().bottom,
    }));
    expect(narrowLayout.controlsBottom).toBeLessThanOrEqual(narrowLayout.filterbarBottom);

    await hide.click();
    await expect(page.getByLabel("Search people")).toHaveCount(0);
  });
}

function registerSwitchesDrawModeBetweenWorkTest() {
  test("switches draw mode between Work and Time off", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    const work = page.getByRole("radio", { name: "Work", exact: true });
    const timeoff = page.getByRole("radio", { name: "Time off", exact: true });
    await expect(work).toHaveAttribute("aria-checked", "true");
    await timeoff.click();
    await expect(timeoff).toHaveAttribute("aria-checked", "true");
    await expect(work).toHaveAttribute("aria-checked", "false");

    // The work bars go inert via a single ancestor layer (ResourceLane's BarsLayer), not a
    // per-bar attribute, so the bar carries no `inert` of its own, but its nearest [inert]
    // ancestor makes it non-interactive, off the tab order, and removed from the a11y tree.
    // Prove the semantics hold through the ancestor: every bar is matched by `[inert] <bar>`,
    // and an attempt to focus one is refused (inert subtrees can't take focus).
    await resetSchedulerScroll(page);
    const bar = page.getByTestId("allocation-bar").first();
    await expect(bar).toBeVisible();
    await expect(page.locator('[inert] [data-testid="allocation-bar"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="allocation-bar"]:not([inert] *)')).toHaveCount(0);
    expect(
      await bar.evaluate((el) => {
        el.focus();
        return document.activeElement === el;
      }),
    ).toBe(false);

    await work.click();
    await expect(page.locator('[inert] [data-testid="allocation-bar"]')).toHaveCount(0);
    expect(
      await bar.evaluate((el) => {
        el.focus();
        return document.activeElement === el;
      }),
    ).toBe(true);
  });
}

// Button coverage and keyboard coverage must both exercise undo/redo; shortcuts must ignore editable fields.
function registerUndoesRedoesToolbarButtonsDisabledTest() {
  test("undoes and redoes with the toolbar buttons, disabled when the stack is empty", async ({ page }) => {
    await openApp(page);
    const undoBtn = page.getByTestId("undo-button");
    const redoBtn = page.getByTestId("redo-button");
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const before = await page.getByTestId("allocation-bar").count();
    await page.getByTestId("allocation-bar").filter({ hasText: "Brand System" }).click();
    await page.getByRole("dialog", { name: "Edit allocation" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog", { name: "Delete allocation?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);
    await expect(undoBtn).toBeEnabled();

    await undoBtn.click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before);
    await expect(redoBtn).toBeEnabled();

    await redoBtn.click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);
  });
}

function registerUndoesRedoesKeyboardIgnoresShortcutTests() {
  test("undoes/redoes with the keyboard and ignores the shortcut while typing", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const before = await page.getByTestId("allocation-bar").count();
    await page.getByTestId("allocation-bar").filter({ hasText: "Brand System" }).click();
    await page.getByRole("dialog", { name: "Edit allocation" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog", { name: "Delete allocation?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);

    await page.getByLabel("Search people").click();
    await page.keyboard.press("Meta+z");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);

    await page.getByTestId("scheduler-grid").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Meta+z");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before);
    await page.keyboard.press("Meta+Shift+z");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);
  });
}

test.describe("Toolbar", () => {
  registerZoomsTimelineTracksActiveLevelTest();
  registerShowsZoomLevelDropdownOpensTest();
  registerPansWindowWeekPrevNextTest();
  registerReCentresTodayScrollingAwayTest();
  registerDoesExposeJumpDatePickerTest();
  registerShowsResponsiveFilterRowSearchTest();
  registerSwitchesDrawModeBetweenWorkTest();
  registerUndoesRedoesToolbarButtonsDisabledTest();
  registerUndoesRedoesKeyboardIgnoresShortcutTests();
});
