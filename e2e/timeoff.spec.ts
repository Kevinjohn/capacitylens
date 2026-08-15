import { test, expect } from "./fixtures";
import { goToSeedWeek, openApp, resetSchedulerScroll, selectShadOption, setZoom } from "./helpers";

// Covers US-TOF-01..05.
test.describe("Time off", () => {
  test("books time off and shows it as a labelled block on the schedule", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/timeoff");
    await page.getByRole("button", { name: "Add time off" }).click();
    const dialog = page.getByRole("dialog", { name: "Add time off" });
    await selectShadOption(dialog.getByLabel("Resource"), { label: "Clark Kent" });
    await dialog.getByLabel("Start").fill("2026-06-17");
    await dialog.getByLabel("End").fill("2026-06-19");
    const note = dialog.getByRole("textbox", { name: "Note" });
    await expect(note).toHaveJSProperty("tagName", "INPUT");
    await note.fill("Conference");
    await page.getByRole("button", { name: "Save" }).click();

    const clarkGroup = page
      .getByTestId("timeoff-group")
      .filter({ has: page.getByRole("heading", { name: "Clark Kent", exact: true }) });
    await expect(clarkGroup.getByTestId("timeoff-row")).toBeVisible();

    await clarkGroup.getByRole("button", { name: /^Edit / }).click();
    const editor = page.getByRole("dialog", { name: "Edit time off" });
    await expect(editor.getByRole("textbox", { name: "Note" })).toHaveValue("Conference");
    await editor.getByRole("button", { name: "Cancel" }).click();

    // It renders as a labelled block on Clark's lane.
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    await expect(page.locator('[data-resource-id="r-nike"]').getByTestId("timeoff-block")).toBeVisible();
  });

  test("groups current and future entries by resource and orders groups and dates", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/timeoff");

    await page.getByRole("button", { name: "Add time off" }).click();
    let dialog = page.getByRole("dialog", { name: "Add time off" });
    await selectShadOption(dialog.getByLabel("Resource"), { label: "Clark Kent" });
    await dialog.getByLabel("Start").fill("2026-06-17");
    await dialog.getByLabel("End").fill("2026-06-19");
    await dialog.getByRole("button", { name: "Save" }).click();

    await page.getByRole("button", { name: "Add time off" }).click();
    dialog = page.getByRole("dialog", { name: "Add time off" });
    await selectShadOption(dialog.getByLabel("Resource"), { label: "Bruce Wayne" });
    await dialog.getByLabel("Start").fill("2026-06-08");
    await dialog.getByLabel("End").fill("2026-06-09");
    await dialog.getByRole("button", { name: "Save" }).click();

    const groups = page.getByTestId("timeoff-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.locator("h2")).toHaveText(["Bruce Wayne", "Clark Kent"]);

    const bruceRows = groups.nth(0).getByTestId("timeoff-row");
    await expect(bruceRows).toHaveCount(2);
    await expect(bruceRows.nth(0)).toContainText("Mon 8th Jun");
    await expect(bruceRows.nth(1)).toContainText("Wed 10th Jun");

    // The first sorted row's action still targets that exact entry.
    await bruceRows
      .nth(0)
      .getByRole("button", { name: /^Edit / })
      .click();
    await expect(page.getByRole("dialog", { name: "Edit time off" }).getByLabel("Start")).toHaveValue("2026-06-08");
  });

  test("keeps the list row terse (start date + day count); the type label stays on the timeline", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/timeoff");
    const row = page
      .getByTestId("timeoff-group")
      .filter({ has: page.getByRole("heading", { name: "Bruce Wayne", exact: true }) })
      .getByTestId("timeoff-row");
    // The list row is intentionally terse: the start date and how many days — no end date, no type.
    // (Seed: Bruce off 10–12 June, starting a Wednesday, three inclusive days.)
    await expect(row).toContainText("Wed 10th Jun");
    await expect(row).toContainText("3 days");
    await expect(row).not.toContainText("Holiday");

    // The readable type label still lives on the timeline block (zoom 1w so the label renders).
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 1);
    await goToSeedWeek(page);
    const block = page.locator('[data-resource-id="r-tyler"]').getByTestId("timeoff-block");
    await expect(block).toContainText("Holiday"); // the human label…
    await expect(block).not.toContainText("holiday"); // …not the raw enum
  });

  test("edits a time-off entry and the list reflects the change", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/timeoff");
    const row = page
      .getByTestId("timeoff-group")
      .filter({ has: page.getByRole("heading", { name: "Bruce Wayne", exact: true }) })
      .getByTestId("timeoff-row");
    await row.getByRole("button", { name: /^Edit / }).click();
    const dialog = page.getByRole("dialog", { name: "Edit time off" });
    await selectShadOption(dialog.getByLabel("Type"), { label: "Sick" });
    // exact: the seed entry's Note ("Long weekend") otherwise substring-matches "End".
    await dialog.getByLabel(/^End/).fill("2026-06-11"); // shorten 12 June → 11 June
    await page.getByRole("button", { name: "Save" }).click();

    // The list shows the start date + day count, so shortening the end reflects as a smaller count.
    await expect(row).toContainText("Wed 10th Jun"); // start unchanged
    await expect(row).toContainText("2 days"); // was 3 days
    await expect(row).not.toContainText("3 days");

    // The type change persisted too — reopen the editor to confirm (the type isn't in the list).
    await row.getByRole("button", { name: /^Edit / }).click();
    await expect(page.getByRole("dialog", { name: "Edit time off" }).getByLabel("Type")).toHaveText("Sick");
  });

  test("deletes a time-off entry after confirmation and restores it with undo", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/timeoff");
    const bruceGroup = page
      .getByTestId("timeoff-group")
      .filter({ has: page.getByRole("heading", { name: "Bruce Wayne", exact: true }) });
    const row = bruceGroup.getByTestId("timeoff-row");

    // The same record exists on the schedule before deletion.
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 1);
    await goToSeedWeek(page);
    const block = page.locator('[data-resource-id="r-tyler"]').getByTestId("timeoff-block");
    await expect(block).toContainText("Holiday");
    await page.getByRole("link", { name: "Time off" }).click();

    // Cancel is a no-op.
    await row.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete time off?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(block).toHaveCount(0);

    await page.keyboard.press("Meta+z");
    await expect(block).toContainText("Holiday");
    await page.getByRole("link", { name: "Time off" }).click();
    await expect(bruceGroup.getByTestId("timeoff-row")).toBeVisible();
  });
});
