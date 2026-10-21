import { test, expect } from "./fixtures";
import {
  boundingBoxOrThrow as box,
  goToSeedWeek,
  selectShadOption,
  setZoom,
  showScheduleFilters,
} from "./browserTestSupport";
import { openApp } from "./appEntrySupport";
import { resetSchedulerScroll } from "./schedulerGeometrySupport";

// Covers US-TOF-01..05.
function registerBooksTimeOffShowsLabelledTest() {
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

    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    await expect(page.locator('[data-resource-id="r-nike"]').getByTestId("timeoff-block")).toBeVisible();
  });
}

function registerGroupsCurrentFutureEntriesResourceTest() {
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
    // Per-resource groups sit one level below the page's "Company closures" / "Personal time off"
    // section headings, so a group's own name is an h3.
    await expect(groups.locator("h3")).toHaveText(["Bruce Wayne", "Clark Kent"]);

    const bruceRows = groups.nth(0).getByTestId("timeoff-row");
    await expect(bruceRows).toHaveCount(2);
    await expect(bruceRows.nth(0)).toContainText("Mon 8th Jun");
    await expect(bruceRows.nth(1)).toContainText("Wed 10th Jun");

    await bruceRows
      .nth(0)
      .getByRole("button", { name: /^Edit / })
      .click();
    await expect(page.getByRole("dialog", { name: "Edit time off" }).getByLabel("Start")).toHaveValue("2026-06-08");
  });
}

function registerKeepsListRowTerseStartTest() {
  test("keeps the list row terse (start date + day count); the type label stays on the timeline", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/timeoff");
    const row = page
      .getByTestId("timeoff-group")
      .filter({ has: page.getByRole("heading", { name: "Bruce Wayne", exact: true }) })
      .getByTestId("timeoff-row");
    // The list row omits the end date and type, so the count is its only duration summary.
    // (Seed: Bruce off 10–12 June, starting a Wednesday, three inclusive days.)
    await expect(row).toContainText("Wed 10th Jun");
    await expect(row).toContainText("3 days");
    await expect(row).not.toContainText("Holiday");

    // The readable type label still lives on the timeline block (zoom 1w so the label renders).
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 1);
    await goToSeedWeek(page);
    const block = page.locator('[data-resource-id="r-tyler"]').getByTestId("timeoff-block");
    await expect(block).toContainText("Holiday");
    await expect(block).not.toContainText("holiday");
  });
}

function registerEditsTimeOffEntryListTest() {
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
    await dialog.getByLabel(/^End/).fill("2026-06-11");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(row).toContainText("Wed 10th Jun");
    await expect(row).toContainText("2 days");
    await expect(row).not.toContainText("3 days");

    // Reopen the editor to confirm the selected type persisted; the list does not show it.
    await row.getByRole("button", { name: /^Edit / }).click();
    await expect(page.getByRole("dialog", { name: "Edit time off" }).getByLabel("Type")).toHaveText("Sick");
  });
}

function registerDeletesTimeOffEntryConfirmationTest() {
  test("deletes a time-off entry after confirmation and restores it with undo", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/timeoff");
    const bruceGroup = page
      .getByTestId("timeoff-group")
      .filter({ has: page.getByRole("heading", { name: "Bruce Wayne", exact: true }) });
    const row = bruceGroup.getByTestId("timeoff-row");

    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 1);
    await goToSeedWeek(page);
    const block = page.locator('[data-resource-id="r-tyler"]').getByTestId("timeoff-block");
    await expect(block).toContainText("Holiday");
    await page.getByRole("link", { name: "Time off" }).click();

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
}

function registerCreatesRepeatedTimeOffIndependentTests() {
  test("creates repeated time off as independent entries with one undo", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/timeoff");
    await page.getByRole("button", { name: "Add time off" }).click();
    const dialog = page.getByRole("dialog", { name: "Add time off" });
    await selectShadOption(dialog.getByLabel("Resource"), { label: "Bruce Wayne" });
    await dialog.getByLabel("Start").fill("2026-06-26");
    await dialog.getByLabel("End").fill("2026-06-27");
    await selectShadOption(dialog.getByTestId("timeoff-repeat"), {
      label: "Monthly on the last Friday",
    });
    await dialog.getByTestId("timeoff-repeat-until").fill("2027-05-31");

    const preview = dialog.getByTestId("timeoff-repeat-preview");
    await expect(preview).toContainText("Creates 12 entries");
    await expect(preview).toContainText("Final entry: 28 – 29 May 2027");
    await dialog.getByText("Show all dates").click();
    await expect(dialog.getByTestId("timeoff-repeat-ranges").getByRole("listitem")).toHaveCount(12);
    await dialog.getByRole("button", { name: "Save" }).click();

    const bruceRows = page
      .getByTestId("timeoff-group")
      .filter({ has: page.getByRole("heading", { name: "Bruce Wayne", exact: true }) })
      .getByTestId("timeoff-row");
    await expect(bruceRows).toHaveCount(13);

    await bruceRows
      .nth(1)
      .getByRole("button", { name: /^Edit / })
      .click();
    const editor = page.getByRole("dialog", { name: "Edit time off" });
    await expect(editor.getByLabel("Repeat")).toHaveCount(0);
    await editor.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("link", { name: "Schedule" }).click();
    const bruceLane = page.locator('[data-resource-id="r-tyler"]');
    await expect.poll(() => bruceLane.getByTestId("timeoff-block").count()).toBeGreaterThan(1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(bruceLane.getByTestId("timeoff-block")).toHaveCount(1);
  });
}

function registerBookingTimeOffGreysScheduleTest() {
  test("booking time off greys the schedule", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expect(page.getByTestId("timeoff-block").first()).toBeVisible();
    const blocksBefore = await page.getByTestId("timeoff-block").count();

    await page.getByRole("link", { name: "Time off" }).click();
    await page.getByRole("button", { name: "Add time off" }).click();
    await selectShadOption(page.getByLabel("Resource"), {
      label: "Clark Kent",
    });
    await page.getByLabel("Start", { exact: true }).fill("2026-06-18");
    await page.getByLabel("End").fill("2026-06-20");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("timeoff-row")).toHaveCount(2);

    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expect.poll(() => page.getByTestId("timeoff-block").count()).toBeGreaterThan(blocksBefore);
  });
}

function registerDrawingTimeOffModeOpensTest() {
  test("drawing in Time off mode opens a prefilled time-off form", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    await setZoom(page, 4);
    // Toolbar draw-mode radio, distinct from the "Time off" nav link.
    await page.getByRole("radio", { name: "Time off", exact: true }).click();

    const lane = page.locator('[data-resource-id="r-nike"]');
    const b = await box(lane);
    const y = b.y + b.height / 2;
    // Start on Clark's next empty working day. The global/personal working-day
    // contract deliberately rejects a time-off gesture that starts on a blocked day.
    const monday = await box(page.locator('[data-date="2026-06-08"]'));
    const x0 = monday.x + monday.width / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 + 72, y, { steps: 6 });
    await page.mouse.up();

    const dialog = page.getByRole("dialog", { name: "Add time off" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Resource")).toHaveText("Clark Kent");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog", { name: "Add time off" })).toHaveCount(0);
  });
}

test.describe("Time off", () => {
  registerBooksTimeOffShowsLabelledTest();
  registerGroupsCurrentFutureEntriesResourceTest();
  registerKeepsListRowTerseStartTest();
  registerEditsTimeOffEntryListTest();
  registerDeletesTimeOffEntryConfirmationTest();
  registerCreatesRepeatedTimeOffIndependentTests();
  registerBookingTimeOffGreysScheduleTest();
  registerDrawingTimeOffModeOpensTest();
});
