import { test, expect } from "./fixtures";
import { openApp, setZoom } from "./helpers";

// Covers US-KBD-01..03, 05. (US-KBD-04 axe lives in e2e/a11y.spec.ts.)
test.describe("Keyboard & accessibility", () => {
  test("an allocation bar is focusable and Enter opens the editor", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" });
    await bar.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Edit allocation" })).toBeVisible();
  });

  test("arrow keys move a focused bar by a day", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" });
    await bar.focus();
    await page.keyboard.press("ArrowRight");
    await expect(bar).toHaveAccessibleName(/2 Jun to 5 Jun/);
    await expect(bar).toBeFocused();
  });

  test("a modal traps focus, closes on Escape, and restores its trigger", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    const trigger = page.getByRole("button", { name: "Add resource" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Add resource" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    const name = page.getByRole("textbox", { name: "Name", exact: true });
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(name).toBeFocused();

    await save.focus();
    await page.keyboard.press("Tab");
    await expect(name).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(save).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("the scheduler exposes grid roles and an sr-only per-row capacity summary", async ({ page }) => {
    await openApp(page);
    const grid = page.getByRole("grid", { name: "Resource schedule" });
    await expect(grid).toBeVisible();
    // The grid honestly declares its 2-column structure (WCAG 1.3.1): col 1 = the sticky
    // resource/utilisation column, col 2 = the timeline lane.
    await expect(grid).toHaveAttribute("aria-colcount", "2");
    await expect(page.getByRole("rowheader", { name: /Bruce Wayne/ })).toBeVisible();
    // The lane cell (col 2) carries an accessible name ("<name> timeline") so it isn't an
    // unnamed gridcell, and exposes aria-colindex=2 to match the declared columns.
    const lane = page.getByRole("gridcell", { name: /Bruce Wayne timeline/ });
    await expect(lane).toBeVisible();
    await expect(lane).toHaveAttribute("aria-colindex", "2");
    await expect(page.getByText(/\d+ allocation/).first()).toBeAttached(); // sr-only summary
  });

  test("an invalid field is marked aria-invalid and described by the error", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    await page.getByRole("button", { name: "Add resource" }).click();
    await page.getByRole("button", { name: "Save" }).click(); // blank name

    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toHaveAttribute("aria-invalid", "true");
    const describedBy = await name.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.getByRole("alert")).toHaveAttribute("id", describedBy!);

    await name.fill("Accessible resource");
    const workingDays = page.getByRole("group", { name: "Working days" });
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      await page.getByRole("radio", { name: `${day} Not working` }).click();
    }
    await page.getByRole("button", { name: "Save" }).click();

    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await expect(name).not.toHaveAttribute("aria-describedby");
    await expect(workingDays).toHaveAttribute("aria-invalid", "true");
    const workingDaysDescribedBy = await workingDays.getAttribute("aria-describedby");
    expect(workingDaysDescribedBy).toBeTruthy();
    await expect(page.getByRole("alert")).toHaveAttribute("id", workingDaysDescribedBy!);

    await page.getByRole("radio", { name: "Monday Full day" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("resource-row").filter({ hasText: "Accessible resource" })).toBeVisible();
  });
});
