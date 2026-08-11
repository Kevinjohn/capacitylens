import { test, expect, type Locator } from "./fixtures";
import { openApp, setZoom, showScheduleFilters } from "./helpers";

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
}

// Covers US-TBR-01..07 and the toolbar-owned week-snap cases from US-TBR-08; scheduler.spec.ts
// covers the remaining US-TBR-08 navigation paths.
test.describe("Toolbar", () => {
  test("zooms the timeline and tracks the active level", async ({ page }) => {
    await openApp(page);
    // #173: the weeks dropdown replaced the 1w..8w segments — the current span is the closed
    // trigger's own text, so "which level is active" is readable without opening anything.
    const weeks = page.getByRole("combobox", { name: "Weeks visible" });
    await setZoom(page, 6);
    await expect(weeks).toHaveText("6 weeks");
    await expect(page.getByText("Utilisation · 6w")).toBeVisible();

    await setZoom(page, 8);
    await expect(weeks).toHaveText("8 weeks");

    await setZoom(page, 1);
    await expect(weeks).toHaveText("1 week");
  });

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

  test("pans the window a week with Prev and Next", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Brand System" });
    const b0 = await box(bar);

    // Panning forward moves the origin later, so a fixed-date bar shifts left.
    await page.getByRole("button", { name: "Next" }).click();
    const b1 = await box(bar);
    expect(b1.x).toBeLessThan(b0.x);

    // Prev brings it back to the right.
    await page.getByRole("button", { name: "Prev" }).click();
    const b2 = await box(bar);
    expect(b2.x).toBeGreaterThan(b1.x);
  });

  test("re-centres on Today after scrolling away", async ({ page }) => {
    await openApp(page);
    const grid = page.getByTestId("scheduler-grid");
    await grid.evaluate((el) => {
      (el as HTMLElement).scrollLeft = 5000;
    });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeLessThan(4000);
  });

  // The jump-to-date picker is hidden from the toolbar (#173), so there is nothing to drive here.
  // Its coverage lives at the two levels that still exercise it: the component
  // (src/components/scheduler/JumpToDateInput.test.tsx) and the week-start snap it triggers
  // (goToDate in src/store/useStore.test.ts). This test asserts only that it is gone from the bar.
  test("does not expose the jump-to-date picker", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-toolbar")).toBeVisible();
    await expect(page.getByLabel("Jump to date")).toHaveCount(0);
  });

  test("shows and hides the secondary filter row beside the schedule title", async ({ page }) => {
    await openApp(page);
    const show = page.getByRole("button", { name: "Show filters" });

    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(show.locator("svg")).toHaveCount(1);
    await expect(page.getByLabel("Search people")).toHaveCount(0);
    await show.click();

    const hide = page.getByRole("button", { name: "Hide filters" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Search people")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Draw mode" })).toBeVisible();

    await hide.click();
    await expect(page.getByLabel("Search people")).toHaveCount(0);
  });

  test("switches draw mode between Work and Time off", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    const work = page.getByRole("radio", { name: "Work", exact: true });
    const timeoff = page.getByRole("radio", { name: "Time off", exact: true });
    await expect(work).toHaveAttribute("aria-checked", "true");
    await timeoff.click();
    await expect(timeoff).toHaveAttribute("aria-checked", "true");
    await expect(work).toHaveAttribute("aria-checked", "false");

    // The work bars go inert via a SINGLE ancestor layer (ResourceLane's BarsLayer), not a
    // per-bar attribute — so the bar carries no `inert` of its own, but its nearest [inert]
    // ancestor makes it non-interactive, off the tab order, and removed from the a11y tree.
    // Prove the semantics hold THROUGH the ancestor: every bar is matched by `[inert] <bar>`,
    // and an attempt to focus one is refused (inert subtrees can't take focus).
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    const bar = page.getByTestId("allocation-bar").first();
    await expect(bar).toBeVisible();
    // The bar lives under an [inert] ancestor (the BarsLayer); no bar is outside one.
    await expect(page.locator('[inert] [data-testid="allocation-bar"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="allocation-bar"]:not([inert] *)')).toHaveCount(0);
    // Inert ⇒ unfocusable: a focus() attempt leaves activeElement off the bar.
    expect(
      await bar.evaluate((el) => {
        el.focus();
        return document.activeElement === el;
      }),
    ).toBe(false);

    // Toggling back to Work clears the ancestor inert — the bar is interactive (focusable) again.
    await work.click();
    await expect(page.locator('[inert] [data-testid="allocation-bar"]')).toHaveCount(0);
    expect(
      await bar.evaluate((el) => {
        el.focus();
        return document.activeElement === el;
      }),
    ).toBe(true);
  });

  // Undo/redo now has BOTH a visible affordance (the toolbar buttons) and the global
  // ⌘Z / ⌘⇧Z shortcut (handled in AppShell). This test drives the buttons + their
  // disabled states; the keyboard test below covers the shortcut path + the typing guard.
  test("undoes and redoes with the toolbar buttons, disabled when the stack is empty", async ({ page }) => {
    await openApp(page);
    const undoBtn = page.getByTestId("undo-button");
    const redoBtn = page.getByTestId("redo-button");
    // Fresh load (account just picked): nothing to undo or redo.
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // Make a mutation (delete an allocation) → Undo becomes available.
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const before = await page.getByTestId("allocation-bar").count();
    await page.getByTestId("allocation-bar").filter({ hasText: "Brand System" }).click();
    await page.getByRole("dialog", { name: "Edit allocation" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog", { name: "Delete allocation?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);
    await expect(undoBtn).toBeEnabled();

    // Click Undo → the bar is restored and Redo becomes available.
    await undoBtn.click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before);
    await expect(redoBtn).toBeEnabled();

    // Click Redo → the delete re-applies.
    await redoBtn.click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);
  });

  test("undoes/redoes with the keyboard and ignores the shortcut while typing", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const before = await page.getByTestId("allocation-bar").count();
    await page.getByTestId("allocation-bar").filter({ hasText: "Brand System" }).click();
    await page.getByRole("dialog", { name: "Edit allocation" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog", { name: "Delete allocation?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);

    // Typing in the search box must NOT trigger undo.
    await page.getByLabel("Search people").click();
    await page.keyboard.press("Meta+z");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);

    // Outside an input, ⌘Z undoes and ⌘⇧Z redoes.
    await page.getByTestId("scheduler-grid").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Meta+z");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before);
    await page.keyboard.press("Meta+Shift+z");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);
  });
});
